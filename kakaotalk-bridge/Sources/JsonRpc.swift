// JsonRpc.swift – JSON-RPC 2.0 protocol handling for kakaotalk-bridge.
// Reads newline-delimited requests from stdin, writes responses to stdout.

import Foundation

// MARK: - Error codes

/// Standard and custom JSON-RPC error codes.
enum RpcErrorCode {
    static let parseError: Int = -32700
    static let methodNotFound: Int = -32601
    static let appNotRunning: Int = -32000
    static let noAccessibility: Int = -32001
    static let windowNotFound: Int = -32002
    static let chatNotFound: Int = -32003
    static let inputNotFound: Int = -32004
    static let timeout: Int = -32005
}

// MARK: - Request / Response types

/// Incoming JSON-RPC 2.0 request (used only within the synchronous server loop).
struct RpcRequest {
    let id: Int
    let method: String
    let params: [String: Any]

    /// Parse a raw JSON dictionary into an RpcRequest.
    /// Returns nil when the dictionary is not a valid JSON-RPC 2.0 request.
    static func from(_ dict: [String: Any]) -> RpcRequest? {
        guard let id = dict["id"] as? Int,
              let method = dict["method"] as? String else {
            return nil
        }
        let params = dict["params"] as? [String: Any] ?? [:]
        return RpcRequest(id: id, method: method, params: params)
    }
}

/// JSON-RPC 2.0 error object.
struct RpcError: Sendable {
    let code: Int
    let message: String
    /// Optional detail string (serialised as `"data"` in the JSON error object).
    let data: String?

    init(code: Int, message: String, data: String? = nil) {
        self.code = code
        self.message = message
        self.data = data
    }

    func toDict() -> [String: Any] {
        var dict: [String: Any] = ["code": code, "message": message]
        if let data { dict["data"] = data }
        return dict
    }

    // Convenience constructors for common errors.
    static func parseError(_ detail: String? = nil) -> RpcError {
        RpcError(code: RpcErrorCode.parseError, message: "Parse error", data: detail)
    }

    static func methodNotFound(_ method: String) -> RpcError {
        RpcError(code: RpcErrorCode.methodNotFound, message: "Method not found: \(method)")
    }

    static func appNotRunning() -> RpcError {
        RpcError(code: RpcErrorCode.appNotRunning, message: "KakaoTalk is not running")
    }

    static func noAccessibility() -> RpcError {
        RpcError(code: RpcErrorCode.noAccessibility, message: "Accessibility permission not granted")
    }

    static func windowNotFound(_ name: String? = nil) -> RpcError {
        let msg = name.map { "Window not found: \($0)" } ?? "Window not found"
        return RpcError(code: RpcErrorCode.windowNotFound, message: msg)
    }

    static func chatNotFound(_ name: String) -> RpcError {
        RpcError(code: RpcErrorCode.chatNotFound, message: "Chat not found: \(name)")
    }

    static func inputNotFound() -> RpcError {
        RpcError(code: RpcErrorCode.inputNotFound, message: "Input field not found")
    }

    static func timeout(_ detail: String? = nil) -> RpcError {
        let msg = detail.map { "Timeout: \($0)" } ?? "Timeout"
        return RpcError(code: RpcErrorCode.timeout, message: msg)
    }
}

/// Thrown by method handlers to signal an RPC error.
struct RpcMethodError: Error, Sendable {
    let rpcError: RpcError
}

// MARK: - Response helpers

/// Build a JSON-RPC 2.0 success response dictionary.
func rpcSuccessResponse(id: Int, result: Any) -> [String: Any] {
    ["jsonrpc": "2.0", "id": id, "result": result]
}

/// Build a JSON-RPC 2.0 error response dictionary.
func rpcErrorResponse(id: Int, error: RpcError) -> [String: Any] {
    ["jsonrpc": "2.0", "id": id, "error": error.toDict()]
}

/// Build a JSON-RPC 2.0 error response for parse errors (no valid id available).
func rpcParseErrorResponse(detail: String? = nil) -> [String: Any] {
    let err = RpcError.parseError(detail)
    // JSON-RPC spec: use null id for parse errors where id cannot be determined.
    return ["jsonrpc": "2.0", "id": NSNull(), "error": err.toDict()]
}

// MARK: - Notification (server → client push)

/// Build a JSON-RPC 2.0 notification (no id field).
func rpcNotification(method: String, params: [String: Any]) -> [String: Any] {
    ["method": method, "params": params]
}

// MARK: - Stdio I/O

/// Write a JSON dictionary as a single line to stdout.
func writeJsonLine(_ dict: [String: Any]) {
    guard let data = try? JSONSerialization.data(withJSONObject: dict),
          var line = String(data: data, encoding: .utf8) else {
        return
    }
    line.append("\n")
    FileHandle.standardOutput.write(Data(line.utf8))
}

/// Send a JSON-RPC success response to stdout.
func sendResult(id: Int, result: Any) {
    writeJsonLine(rpcSuccessResponse(id: id, result: result))
}

/// Send a JSON-RPC error response to stdout.
func sendError(id: Int, error: RpcError) {
    writeJsonLine(rpcErrorResponse(id: id, error: error))
}

/// Send a JSON-RPC parse error response to stdout (no valid id).
func sendParseError(detail: String? = nil) {
    writeJsonLine(rpcParseErrorResponse(detail: detail))
}

/// Send a JSON-RPC notification to stdout.
func sendNotification(method: String, params: [String: Any]) {
    writeJsonLine(rpcNotification(method: method, params: params))
}

// MARK: - Stdin reader

/// Read a single line from stdin. Returns nil at EOF.
func readStdinLine() -> String? {
    readLine(strippingNewline: true)
}

// MARK: - Method handler

/// Type alias for a method handler closure.
/// Handlers receive the params dict and return a result value (serialisable to JSON).
typealias RpcMethodHandler = ([String: Any]) throws -> Any

// MARK: - Server loop

/// JSON-RPC server that reads from stdin and dispatches to registered handlers.
final class JsonRpcServer {
    private var handlers: [String: RpcMethodHandler] = [:]

    init() {}

    /// Register a method handler. Call before `run()`.
    func register(_ method: String, handler: @escaping RpcMethodHandler) {
        handlers[method] = handler
    }

    /// Main server loop — blocks on stdin, dispatches requests, writes responses.
    /// This runs synchronously on the calling thread.
    func run() {
        while let line = readStdinLine() {
            let trimmed = line.trimmingCharacters(in: .whitespacesAndNewlines)
            if trimmed.isEmpty { continue }

            // Parse JSON
            guard let data = trimmed.data(using: .utf8),
                  let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
                sendParseError(detail: "Malformed JSON")
                continue
            }

            // Parse request fields (id + method required)
            guard let request = RpcRequest.from(json) else {
                sendParseError(detail: "Missing id or method")
                continue
            }

            // Dispatch to handler
            guard let handler = handlers[request.method] else {
                sendError(id: request.id, error: .methodNotFound(request.method))
                continue
            }

            do {
                let result = try handler(request.params)
                sendResult(id: request.id, result: result)
            } catch let err as RpcMethodError {
                sendError(id: request.id, error: err.rpcError)
            } catch {
                // Unexpected errors → generic error response.
                sendError(id: request.id, error: RpcError(
                    code: RpcErrorCode.appNotRunning,
                    message: error.localizedDescription
                ))
            }
        }
    }
}
