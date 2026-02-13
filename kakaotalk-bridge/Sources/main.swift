// main.swift – Entry point for kakaotalk-bridge.
// Parses CLI arguments, registers JSON-RPC method handlers,
// starts the polling loop, and runs the JSON-RPC server.
// Satisfies requirements 1.1, 7.4.

import Foundation

// MARK: - CLI argument parsing

/// Default polling interval in milliseconds.
private let defaultPollIntervalMs = 3000

/// Parse CLI arguments: expects `rpc [--poll-interval <ms>]`.
/// Returns the poll interval in milliseconds, or exits with usage info.
private func parseCLIArguments() -> Int {
    let args = CommandLine.arguments
    // First real argument (index 1) should be "rpc"
    guard args.count >= 2, args[1] == "rpc" else {
        fputs("Usage: kakaotalk-bridge rpc [--poll-interval <ms>]\n", stderr)
        exit(1)
    }

    var pollIntervalMs = defaultPollIntervalMs
    var i = 2
    while i < args.count {
        if args[i] == "--poll-interval", i + 1 < args.count {
            if let value = Int(args[i + 1]), value > 0 {
                pollIntervalMs = value
            }
            i += 2
        } else {
            i += 1
        }
    }

    return pollIntervalMs
}

// MARK: - Main

let pollIntervalMs = parseCLIArguments()

// Set up the JSON-RPC server and register all method handlers.
let server = JsonRpcServer()

// Req 2.x: check_status
server.register("check_status") { _ in
    checkKakaoTalkStatus().toDict()
}

// Req 3.x: list_chats
server.register("list_chats") { params in
    try handleListChats(params: params)
}

// Req 4.x: open_chat
server.register("open_chat") { params in
    try handleOpenChat(params: params)
}

// Req 5.x: read_messages
server.register("read_messages") { params in
    try handleReadMessages(params: params)
}

// Req 6.x: send_message
server.register("send_message") { params in
    try handleSendMessage(params: params)
}

// Req 7.4: start polling loop on a background thread with the configured interval.
startPollingLoop(intervalMs: pollIntervalMs)

// Req 1.1: start the JSON-RPC server loop (blocks on stdin).
server.run()
