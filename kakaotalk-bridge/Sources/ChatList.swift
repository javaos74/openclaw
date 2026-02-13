// ChatList.swift – Read the KakaoTalk chat list via macOS Accessibility API.
// Navigates: main window → scroll area (AXScrollArea) → table (AXTable) → rows (AXRow).
// Satisfies requirements 3.1–3.4.

import ApplicationServices

// MARK: - Chat entry

/// A single chat list entry extracted from the KakaoTalk main window.
struct ChatEntry: Sendable {
    let name: String
    let lastMessageTime: String
    let unreadCount: Int

    func toDict() -> [String: Any] {
        [
            "name": name,
            "lastMessageTime": lastMessageTime,
            "unreadCount": unreadCount,
        ]
    }
}

// MARK: - Row parsing

/// Extract static text values from a chat list row.
/// KakaoTalk rows typically contain: chat name, last message preview/time, and
/// optionally an unread badge. The exact structure varies, so we collect all
/// static text descendants and apply heuristics.
private func extractStaticTexts(from element: AXUIElement) -> [String] {
    var texts: [String] = []
    collectStaticTexts(element, into: &texts)
    return texts
}

/// Recursively collect AXStaticText values from an element tree.
private func collectStaticTexts(_ element: AXUIElement, into texts: inout [String]) {
    if axRole(element) == "AXStaticText" {
        if let value = axElementValue(element), !value.isEmpty {
            texts.append(value)
        } else if let title = axTitle(element), !title.isEmpty {
            texts.append(title)
        }
    }
    for child in axChildren(element) {
        collectStaticTexts(child, into: &texts)
    }
}

/// Parse a single chat list row into a ChatEntry.
/// Heuristic layout for KakaoTalk chat rows:
///   - First static text → chat name
///   - Second static text → last message time (or preview)
///   - A short numeric-only text → unread count (badge)
private func parseChatRow(_ row: AXUIElement) -> ChatEntry? {
    let texts = extractStaticTexts(from: row)
    guard !texts.isEmpty else { return nil }

    let name = texts[0]
    var lastMessageTime = ""
    var unreadCount = 0

    if texts.count >= 2 {
        lastMessageTime = texts[1]
    }

    // Look for a numeric-only text that represents the unread badge.
    // Skip the first text (name) and check remaining texts.
    for i in 1..<texts.count {
        let trimmed = texts[i].trimmingCharacters(in: .whitespaces)
        if let count = Int(trimmed), count > 0 {
            unreadCount = count
            // If this numeric text was used as lastMessageTime, try to find
            // a better candidate for the time field.
            if i == 1, texts.count >= 3 {
                lastMessageTime = texts[2]
            }
            break
        }
    }

    return ChatEntry(name: name, lastMessageTime: lastMessageTime, unreadCount: unreadCount)
}

// MARK: - list_chats handler

/// Default limit for the number of chats returned.
private let defaultChatLimit = 50

/// Read the chat list from the KakaoTalk main window.
/// - Parameter limit: Maximum number of chats to return (default 50).
/// - Returns: Array of ChatEntry, ordered as they appear in the UI (most recent first).
/// - Throws: `RpcMethodError` when the main window is not accessible.
func listChats(limit: Int = defaultChatLimit) throws -> [ChatEntry] {
    // Req 3.4: main window must be accessible
    guard let mainWindow = kakaoTalkMainWindow() else {
        throw RpcMethodError(rpcError: .windowNotFound("카카오톡"))
    }

    // Navigate: scroll area → table → rows
    // AX path: window "카카오톡" > scroll area 1 > table 1 > row N
    guard let scrollArea = firstChild(of: mainWindow, role: "AXScrollArea") else {
        // No scroll area found — possibly the window is in a different state
        return []
    }

    guard let table = firstChild(of: scrollArea, role: "AXTable") else {
        // No table inside the scroll area
        return []
    }

    // Req 3.1: read rows (already in display order, most recent first)
    let rows = children(of: table, role: "AXRow")

    // Req 3.3: apply limit
    let effectiveLimit = limit > 0 ? limit : defaultChatLimit
    let cappedRows = rows.prefix(effectiveLimit)

    // Req 3.2: extract name, lastMessageTime, unreadCount from each row
    var chats: [ChatEntry] = []
    for row in cappedRows {
        if let entry = parseChatRow(row) {
            chats.append(entry)
        }
    }

    return chats
}

/// JSON-RPC handler for the `list_chats` method.
/// Params: `{ "limit": Int? }` — default 50.
/// Returns: `{ "chats": [{ "name", "lastMessageTime", "unreadCount" }] }`
func handleListChats(params: [String: Any]) throws -> Any {
    let limit = params["limit"] as? Int ?? defaultChatLimit
    let chats = try listChats(limit: limit)
    return ["chats": chats.map { $0.toDict() }]
}
