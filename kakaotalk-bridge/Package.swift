// swift-tools-version: 6.2
// KakaoTalk Accessibility bridge – JSON-RPC 2.0 over stdio.

import PackageDescription

let package = Package(
    name: "kakaotalk-bridge",
    platforms: [
        .macOS(.v14),
    ],
    targets: [
        .executableTarget(
            name: "kakaotalk-bridge",
            path: "Sources",
            swiftSettings: [
                .enableUpcomingFeature("StrictConcurrency"),
            ],
            linkerSettings: [
                .linkedFramework("ApplicationServices"),
            ]),
    ])
