// Accessibility.swift – macOS AX API wrapper for KakaoTalk bridge.
// Provides helpers for process discovery, permission checks, and UI element traversal.

@preconcurrency import ApplicationServices
@preconcurrency import AppKit

// MARK: - KakaoTalk bundle identifier

private let kakaoTalkBundleID = "com.kakao.KakaoTalkMac"

// MARK: - Process discovery

/// Find the running KakaoTalk process. Returns nil when the app is not running.
func findKakaoTalkProcess() -> NSRunningApplication? {
    NSRunningApplication.runningApplications(
        withBundleIdentifier: kakaoTalkBundleID
    ).first
}

/// Whether KakaoTalk is currently running.
func isKakaoTalkRunning() -> Bool {
    findKakaoTalkProcess() != nil
}

// MARK: - Accessibility permission

/// Whether this process has been granted macOS Accessibility permission.
func isAccessibilityGranted() -> Bool {
    AXIsProcessTrusted()
}

/// Prompt the user to grant Accessibility permission (opens System Settings).
/// Returns the current trust state (usually `false` until the user acts).
@discardableResult
func promptAccessibilityPermission() -> Bool {
    // Inline the key string to avoid global CFString Sendable issues.
    let key = "AXTrustedCheckOptionPrompt" as CFString
    let opts = [key: kCFBooleanTrue!] as CFDictionary
    return AXIsProcessTrustedWithOptions(opts)
}

// MARK: - AX element helpers

/// Get a single AX attribute value from an element.
/// Returns nil when the attribute is missing or the call fails.
func axValue(_ element: AXUIElement, attribute: String) -> CFTypeRef? {
    var value: CFTypeRef?
    let err = AXUIElementCopyAttributeValue(element, attribute as CFString, &value)
    guard err == .success else { return nil }
    return value
}

/// Get a string attribute from an AX element.
func axString(_ element: AXUIElement, attribute: String) -> String? {
    axValue(element, attribute: attribute) as? String
}

/// Get the children array of an AX element.
func axChildren(_ element: AXUIElement) -> [AXUIElement] {
    guard let value = axValue(element, attribute: kAXChildrenAttribute as String) else {
        return []
    }
    // CFTypeRef is a CFArray of AXUIElement
    guard let arr = value as? [AXUIElement] else { return [] }
    return arr
}

/// Get the role of an AX element (e.g. "AXWindow", "AXScrollArea").
func axRole(_ element: AXUIElement) -> String? {
    axString(element, attribute: kAXRoleAttribute as String)
}

/// Get the title of an AX element.
func axTitle(_ element: AXUIElement) -> String? {
    axString(element, attribute: kAXTitleAttribute as String)
}

/// Get the value of an AX element (commonly used for text fields).
func axElementValue(_ element: AXUIElement) -> String? {
    axString(element, attribute: kAXValueAttribute as String)
}

/// Get the number of children without fetching them all.
func axChildCount(_ element: AXUIElement) -> Int {
    var count: CFTypeRef?
    let err = AXUIElementCopyAttributeValue(
        element, kAXChildrenAttribute as CFString, &count
    )
    guard err == .success, let arr = count as? [AnyObject] else { return 0 }
    return arr.count
}


/// Get the AX element's position (CGPoint).
func axPosition(_ element: AXUIElement) -> CGPoint? {
    guard let value = axValue(element, attribute: kAXPositionAttribute as String) else {
        return nil
    }
    var point = CGPoint.zero
    guard AXValueGetValue(value as! AXValue, .cgPoint, &point) else { return nil }
    return point
}

/// Get the AX element's size (CGSize).
func axSize(_ element: AXUIElement) -> CGSize? {
    guard let value = axValue(element, attribute: kAXSizeAttribute as String) else {
        return nil
    }
    var size = CGSize.zero
    guard AXValueGetValue(value as! AXValue, .cgSize, &size) else { return nil }
    return size
}

// MARK: - Application element

/// Create an AXUIElement for the KakaoTalk application.
/// Returns nil when KakaoTalk is not running.
func kakaoTalkAppElement() -> AXUIElement? {
    guard let app = findKakaoTalkProcess() else { return nil }
    return AXUIElementCreateApplication(app.processIdentifier)
}

// MARK: - Window discovery

/// Get all windows of the KakaoTalk application.
func kakaoTalkWindows() -> [AXUIElement] {
    guard let appElement = kakaoTalkAppElement() else { return [] }
    guard let value = axValue(appElement, attribute: kAXWindowsAttribute as String),
          let windows = value as? [AXUIElement] else {
        return []
    }
    return windows
}

/// Find a KakaoTalk window by its exact title.
func kakaoTalkWindow(titled name: String) -> AXUIElement? {
    kakaoTalkWindows().first { axTitle($0) == name }
}

/// Find the KakaoTalk main window (titled "카카오톡").
func kakaoTalkMainWindow() -> AXUIElement? {
    kakaoTalkWindow(titled: "카카오톡")
}

// MARK: - Child element traversal

/// Find the first child of an element matching a given role.
func firstChild(of element: AXUIElement, role: String) -> AXUIElement? {
    axChildren(element).first { axRole($0) == role }
}

/// Find the first child matching a role and title.
func firstChild(of element: AXUIElement, role: String, title: String) -> AXUIElement? {
    axChildren(element).first { axRole($0) == role && axTitle($0) == title }
}

/// Find all children of an element matching a given role.
func children(of element: AXUIElement, role: String) -> [AXUIElement] {
    axChildren(element).filter { axRole($0) == role }
}

// MARK: - check_status handler

/// Status result for the `check_status` JSON-RPC method.
struct KakaoTalkStatus {
    let running: Bool
    let accessible: Bool
    let mainWindow: Bool
    let message: String?

    func toDict() -> [String: Any] {
        var dict: [String: Any] = [
            "running": running,
            "accessible": accessible,
            "mainWindow": mainWindow,
        ]
        if let message { dict["message"] = message }
        return dict
    }
}

/// Check the current status of KakaoTalk and Accessibility.
/// Satisfies requirements 2.1–2.5.
func checkKakaoTalkStatus() -> KakaoTalkStatus {
    // Req 2.1 / 2.4: check if KakaoTalk is running
    guard isKakaoTalkRunning() else {
        return KakaoTalkStatus(
            running: false,
            accessible: false,
            mainWindow: false,
            message: "KakaoTalk is not running. Please launch KakaoTalk."
        )
    }

    // Req 2.2 / 2.5: check Accessibility permission
    guard isAccessibilityGranted() else {
        return KakaoTalkStatus(
            running: true,
            accessible: false,
            mainWindow: false,
            message: "Accessibility permission not granted. "
                + "Open System Settings → Privacy & Security → Accessibility "
                + "and enable access for this application."
        )
    }

    // Req 2.3: check main window accessibility
    let hasMainWindow = kakaoTalkMainWindow() != nil
    return KakaoTalkStatus(
        running: true,
        accessible: true,
        mainWindow: hasMainWindow,
        message: hasMainWindow
            ? nil
            : "KakaoTalk main window (\"카카오톡\") not found. "
                + "Make sure KakaoTalk is open and logged in."
    )
}
