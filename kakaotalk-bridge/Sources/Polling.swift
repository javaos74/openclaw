// Polling.swift – Polling loop for new message detection in KakaoTalk.
// Periodically checks Chat_List for unread count changes, reads new messages,
// and sends `new_message` JSON-RPC notifications via stdout.
// Satisfies requirements 7.1–7.4.

import Foundation

// MARK: - Polling loop

/// Start the polling loop on a background thread.
/// The loop runs indefinitely until the process exits.
///
/// - Parameter intervalMs: Polling interval in milliseconds (Req 7.4).
func startPollingLoop(intervalMs: Int) {
    let interval = TimeInterval(max(intervalMs, 100)) / 1000.0

    // Run on a detached background thread to avoid blocking the main JSON-RPC
    // server loop. All mutable state lives inside this thread — no sharing.
    Thread.detachNewThread {
        pollingLoop(interval: interval)
    }
}

/// The actual polling loop. Runs on a dedicated background thread.
/// All mutable state (previousUnreadCounts) is local to this function,
/// so no concurrency synchronisation is needed.
private func pollingLoop(interval: TimeInterval) {
    // Req 7.1: track previous unread counts per chat name
    var previousUnreadCounts: [String: Int] = [:]

    // Small initial delay to let the JSON-RPC server start first.
    Thread.sleep(forTimeInterval: 0.5)

    while true {
        pollOnce(previousUnreadCounts: &previousUnreadCounts)
        Thread.sleep(forTimeInterval: interval)
    }
}

/// Execute a single polling cycle.
/// - Parameter previousUnreadCounts: Mutable dictionary tracking the last-seen
///   unread count for each chat. Updated in place.
private func pollOnce(previousUnreadCounts: inout [String: Int]) {
    // Req 7.1: read current chat list and detect unread count changes
    guard let chats = try? listChats(limit: 50) else {
        return
    }

    for chat in chats {
        let previous = previousUnreadCounts[chat.name] ?? 0
        let current = chat.unreadCount

        // Detect increase in unread count → new messages arrived
        if current > previous {
            handleNewMessages(chatName: chat.name, newCount: current - previous)
        }

        // Always update the tracked count (handles both increases and decreases
        // when the user reads messages in KakaoTalk directly).
        previousUnreadCounts[chat.name] = current
    }

    // Clean up entries for chats that disappeared from the list.
    let currentChatNames = Set(chats.map(\.name))
    for name in previousUnreadCounts.keys where !currentChatNames.contains(name) {
        previousUnreadCounts.removeValue(forKey: name)
    }
}

/// Handle detected new messages for a chat: open the room, read messages,
/// and send `new_message` notifications.
///
/// - Parameters:
///   - chatName: The chat room name where new messages were detected.
///   - newCount: Number of new messages detected (unread delta).
private func handleNewMessages(chatName: String, newCount: Int) {
    // Open the chat room (Req 7.2: need to read the actual messages)
    _ = try? openChat(name: chatName)

    // Read messages from the chat room
    guard let messages = try? readMessages(name: chatName) else {
        return
    }

    // Take the last N messages (matching the unread delta)
    let newMessages = messages.suffix(newCount)

    // Req 7.2, 7.3: send new_message notification for each new message
    for message in newMessages {
        sendNotification(
            method: "new_message",
            params: [
                "chatName": chatName,
                "sender": message.sender,
                "text": message.text,
                "time": message.time,
            ]
        )
    }
}
