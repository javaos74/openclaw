// ChatRoom.swift – Chat room operations for KakaoTalk bridge.
// Provides open_chat, read_messages, and send_message handlers.
// Satisfies requirements 4.1–4.4, 5.1–5.4, 6.1–6.4.

@preconcurrency import ApplicationServices
import Foundation

// MARK: - Constants

/// Timeout in seconds when waiting for a chat room window to appear.
private let windowWaitTimeout: TimeInterval = 5.0

/// Polling interval in seconds when waiting for a window.
private let windowPollInterval: TimeInterval = 0.2

// MARK: - Message entry

/// A single message extracted from a chat room window.
struct MessageEntry: Sendable {
    let sender: String
    let text: String
    let time: String

    func toDict() -> [String: Any] {
        ["sender": sender, "text": text, "time": time]
    }
}

// MARK: - CGEvent helpers

/// Simulate a double-click at the given screen position using CGEvent.
/// Uses mouseEventSource: nil so the OS generates the events.
private func doubleClick(at point: CGPoint) {
    let mouseDown1 = CGEvent(
        mouseEventSource: nil,
        mouseType: .leftMouseDown,
        mouseCursorPosition: point,
        mouseButton: .left
    )
    let mouseUp1 = CGEvent(
        mouseEventSource: nil,
        mouseType: .leftMouseUp,
        mouseCursorPosition: point,
        mouseButton: .left
    )
    let mouseDown2 = CGEvent(
        mouseEventSource: nil,
        mouseType: .leftMouseDown,
        mouseCursorPosition: point,
        mouseButton: .left
    )
    let mouseUp2 = CGEvent(
        mouseEventSource: nil,
        mouseType: .leftMouseUp,
        mouseCursorPosition: point,
        mouseButton: .left
    )

    mouseDown2?.setIntegerValueField(.mouseEventClickState, value: 2)
    mouseUp2?.setIntegerValueField(.mouseEventClickState, value: 2)

    mouseDown1?.post(tap: .cghidEventTap)
    mouseUp1?.post(tap: .cghidEventTap)
    mouseDown2?.post(tap: .cghidEventTap)
    mouseUp2?.post(tap: .cghidEventTap)
}

/// Simulate pressing the Enter/Return key using CGEvent.
private func pressEnter() {
    let keyDown = CGEvent(keyboardEventSource: nil, virtualKey: 0x24, keyDown: true)
    let keyUp = CGEvent(keyboardEventSource: nil, virtualKey: 0x24, keyDown: false)
    keyDown?.post(tap: .cghidEventTap)
    keyUp?.post(tap: .cghidEventTap)
}

// MARK: - Chat row lookup

/// Find a chat list row matching the given name.
/// Returns the AXUIElement for the row, or nil if not found.
private func findChatRow(named name: String) -> AXUIElement? {
    guard let mainWindow = kakaoTalkMainWindow() else { return nil }
    guard let scrollArea = firstChild(of: mainWindow, role: "AXScrollArea") else { return nil }
    guard let table = firstChild(of: scrollArea, role: "AXTable") else { return nil }

    let rows = children(of: table, role: "AXRow")
    for row in rows {
        // Collect static texts from the row; the first one is the chat name.
        let texts = collectRowStaticTexts(from: row)
        if let firstName = texts.first, firstName == name {
            return row
        }
    }
    return nil
}

/// Collect static text values from a row element (same heuristic as ChatList).
private func collectRowStaticTexts(from element: AXUIElement) -> [String] {
    var texts: [String] = []
    gatherStaticTexts(element, into: &texts)
    return texts
}

/// Recursively gather AXStaticText values.
private func gatherStaticTexts(_ element: AXUIElement, into texts: inout [String]) {
    if axRole(element) == "AXStaticText" {
        if let value = axElementValue(element), !value.isEmpty {
            texts.append(value)
        } else if let title = axTitle(element), !title.isEmpty {
            texts.append(title)
        }
    }
    for child in axChildren(element) {
        gatherStaticTexts(child, into: &texts)
    }
}

/// Get the center point of an AX element for click targeting.
private func centerPoint(of element: AXUIElement) -> CGPoint? {
    guard let pos = axPosition(element), let size = axSize(element) else { return nil }
    return CGPoint(x: pos.x + size.width / 2, y: pos.y + size.height / 2)
}

// MARK: - Window waiting

/// Wait for a window with the given title to appear, polling at intervals.
/// Returns the window element on success, nil on timeout.
private func waitForWindow(titled name: String, timeout: TimeInterval = windowWaitTimeout) -> AXUIElement? {
    let deadline = Date().addingTimeInterval(timeout)
    while Date() < deadline {
        if let window = kakaoTalkWindow(titled: name) {
            return window
        }
        Thread.sleep(forTimeInterval: windowPollInterval)
    }
    return nil
}

// MARK: - open_chat

/// Open a chat room by double-clicking its row in the Chat_List.
/// - Parameter name: The chat room name to open.
/// - Returns: Dictionary with `success` and `windowTitle`.
/// - Throws: `RpcMethodError` for chat-not-found or timeout errors.
func openChat(name: String) throws -> [String: Any] {
    // Req 4.1: find the row in Chat_List
    guard let row = findChatRow(named: name) else {
        // Req 4.3: chat not found
        throw RpcMethodError(rpcError: .chatNotFound(name))
    }

    // Req 4.1: CGEvent double-click to open
    guard let point = centerPoint(of: row) else {
        throw RpcMethodError(rpcError: .chatNotFound(name))
    }
    doubleClick(at: point)

    // Req 4.2: wait for the window to appear
    guard let window = waitForWindow(titled: name) else {
        // Req 4.4: timeout
        throw RpcMethodError(rpcError: .timeout("Chat window \"\(name)\" did not appear"))
    }

    let windowTitle = axTitle(window) ?? name
    return ["success": true, "windowTitle": windowTitle]
}

/// JSON-RPC handler for the `open_chat` method.
/// Params: `{ "name": String }`
/// Returns: `{ "success": Bool, "windowTitle": String }`
func handleOpenChat(params: [String: Any]) throws -> Any {
    guard let name = params["name"] as? String else {
        throw RpcMethodError(rpcError: RpcError(
            code: RpcErrorCode.chatNotFound,
            message: "Missing required parameter: name"
        ))
    }
    return try openChat(name: name)
}

// MARK: - read_messages

/// Parse message rows from a chat room window.
/// AX path: window "{name}" > scroll area 1 > table 1 > row N > UI element 1 > static text
/// Each row may contain sender, text, and time as static text descendants.
private func parseMessageRow(_ row: AXUIElement) -> MessageEntry? {
    let texts = collectRowStaticTexts(from: row)
    // KakaoTalk message rows typically have:
    //   - sender name (may be absent for consecutive messages from same sender)
    //   - message text
    //   - time string
    // We use a simple heuristic based on the number of text elements found.
    guard !texts.isEmpty else { return nil }

    switch texts.count {
    case 1:
        // Only message text (sender continuation)
        return MessageEntry(sender: "", text: texts[0], time: "")
    case 2:
        // Could be [sender, text] or [text, time]
        // Heuristic: if second text looks like a time (short, contains : or digits), treat as [text, time]
        if looksLikeTime(texts[1]) {
            return MessageEntry(sender: "", text: texts[0], time: texts[1])
        }
        return MessageEntry(sender: texts[0], text: texts[1], time: "")
    default:
        // 3+ texts: [sender, text, time, ...]
        // Find the last element that looks like a time
        var timeStr = ""
        var timeIdx = -1
        for i in stride(from: texts.count - 1, through: 1, by: -1) {
            if looksLikeTime(texts[i]) {
                timeStr = texts[i]
                timeIdx = i
                break
            }
        }
        let sender = texts[0]
        // Message text is everything between sender and time
        let endIdx = timeIdx > 1 ? timeIdx : texts.count
        let messageTexts = texts[1..<endIdx]
        let text = messageTexts.joined(separator: "\n")
        return MessageEntry(sender: sender, text: text, time: timeStr)
    }
}

/// Simple heuristic to check if a string looks like a time (e.g. "오후 3:42", "15:42").
private func looksLikeTime(_ str: String) -> Bool {
    let trimmed = str.trimmingCharacters(in: .whitespaces)
    // Short string containing a colon or Korean time markers
    if trimmed.count > 20 { return false }
    if trimmed.contains(":") { return true }
    if trimmed.contains("오전") || trimmed.contains("오후") { return true }
    return false
}

/// Read messages from a chat room window.
/// - Parameters:
///   - name: The chat room name (window title).
///   - since: Optional time filter — only return messages with time >= since.
/// - Returns: Array of MessageEntry.
/// - Throws: `RpcMethodError` when the window is not found.
func readMessages(name: String, since: String? = nil) throws -> [MessageEntry] {
    // Req 5.4: window must be open
    guard let window = kakaoTalkWindow(titled: name) else {
        throw RpcMethodError(rpcError: .windowNotFound(name))
    }

    // Req 5.1: navigate scroll area > table > rows
    guard let scrollArea = firstChild(of: window, role: "AXScrollArea") else {
        return []
    }
    guard let table = firstChild(of: scrollArea, role: "AXTable") else {
        return []
    }

    let rows = children(of: table, role: "AXRow")
    var messages: [MessageEntry] = []

    for row in rows {
        if let entry = parseMessageRow(row) {
            messages.append(entry)
        }
    }

    // Req 5.3: filter by since parameter
    if let since, !since.isEmpty {
        messages = messages.filter { msg in
            // Compare time strings lexicographically.
            // This works for consistent time formats (e.g. "오후 3:42").
            // Empty time strings are included (they inherit the previous message's time).
            msg.time.isEmpty || msg.time >= since
        }
    }

    return messages
}

/// JSON-RPC handler for the `read_messages` method.
/// Params: `{ "name": String, "since": String? }`
/// Returns: `{ "messages": [{ "sender", "text", "time" }] }`
func handleReadMessages(params: [String: Any]) throws -> Any {
    guard let name = params["name"] as? String else {
        throw RpcMethodError(rpcError: RpcError(
            code: RpcErrorCode.windowNotFound,
            message: "Missing required parameter: name"
        ))
    }
    let since = params["since"] as? String
    let messages = try readMessages(name: name, since: since)
    return ["messages": messages.map { $0.toDict() }]
}

// MARK: - send_message

/// Find the text input field in a chat room window.
/// AX path: window "{name}" > text field or text area
private func findInputField(in window: AXUIElement) -> AXUIElement? {
    // Try text field first, then text area
    if let field = firstChild(of: window, role: "AXTextField") {
        return field
    }
    if let area = firstChild(of: window, role: "AXTextArea") {
        return area
    }
    // Search deeper — the input field may be nested
    return findInputFieldRecursive(in: window)
}

/// Recursively search for a text input field in the element tree.
private func findInputFieldRecursive(in element: AXUIElement) -> AXUIElement? {
    for child in axChildren(element) {
        let role = axRole(child)
        if role == "AXTextField" || role == "AXTextArea" {
            return child
        }
        if let found = findInputFieldRecursive(in: child) {
            return found
        }
    }
    return nil
}

/// Send a message to a chat room.
/// - Parameters:
///   - name: The chat room name.
///   - text: The message text to send.
/// - Returns: Dictionary with `success`.
/// - Throws: `RpcMethodError` for various error conditions.
func sendMessage(name: String, text: String) throws -> [String: Any] {
    // Req 6.4: reject empty text
    let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
    if trimmed.isEmpty {
        throw RpcMethodError(rpcError: RpcError(
            code: RpcErrorCode.inputNotFound,
            message: "Cannot send empty message"
        ))
    }

    // Req 6.2: auto-open chat room if not already open
    var window = kakaoTalkWindow(titled: name)
    if window == nil {
        _ = try openChat(name: name)
        window = kakaoTalkWindow(titled: name)
    }

    guard let chatWindow = window else {
        throw RpcMethodError(rpcError: .windowNotFound(name))
    }

    // Req 6.3: find input field
    guard let inputField = findInputField(in: chatWindow) else {
        throw RpcMethodError(rpcError: .inputNotFound())
    }

    // Req 6.1: set the text value and simulate Enter
    // Focus the input field first
    AXUIElementSetAttributeValue(
        inputField,
        kAXFocusedAttribute as CFString,
        kCFBooleanTrue
    )

    // Set the text value
    AXUIElementSetAttributeValue(
        inputField,
        kAXValueAttribute as CFString,
        text as CFTypeRef
    )

    // Small delay to let the UI process the value change
    Thread.sleep(forTimeInterval: 0.1)

    // Simulate Enter key press to send
    pressEnter()

    return ["success": true]
}

/// JSON-RPC handler for the `send_message` method.
/// Params: `{ "name": String, "text": String }`
/// Returns: `{ "success": Bool }`
func handleSendMessage(params: [String: Any]) throws -> Any {
    guard let name = params["name"] as? String else {
        throw RpcMethodError(rpcError: RpcError(
            code: RpcErrorCode.chatNotFound,
            message: "Missing required parameter: name"
        ))
    }
    guard let text = params["text"] as? String else {
        throw RpcMethodError(rpcError: RpcError(
            code: RpcErrorCode.inputNotFound,
            message: "Missing required parameter: text"
        ))
    }
    return try sendMessage(name: name, text: text)
}
