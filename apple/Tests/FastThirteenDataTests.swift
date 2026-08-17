import XCTest
@testable import FastThirteenMac

final class FastThirteenDataTests: XCTestCase {
    func testMergeKeepsNewerLocalSessionAndRemoteOnlySession() {
        let startedAt = Date(timeIntervalSince1970: 1_000)
        let local = FastingSession(id: "local", startedAt: startedAt, endedAt: nil, targetHours: 13, updatedAt: Date(timeIntervalSince1970: 2_000), deletedAt: nil)
        let staleRemote = FastingSession(id: "local", startedAt: startedAt, endedAt: startedAt.addingTimeInterval(13 * 3_600), targetHours: 13, updatedAt: Date(timeIntervalSince1970: 1_500), deletedAt: nil)
        let remoteOnly = FastingSession(id: "remote", startedAt: startedAt, endedAt: startedAt.addingTimeInterval(14 * 3_600), targetHours: 13, updatedAt: Date(timeIntervalSince1970: 2_500), deletedAt: nil)

        let merged = FastThirteenData(sessions: [local]).merged(with: FastThirteenData(sessions: [staleRemote, remoteOnly]))

        XCTAssertEqual(merged.sessions.count, 2)
        XCTAssertNil(merged.sessions.first(where: { $0.id == "local" })?.endedAt)
        XCTAssertNotNil(merged.sessions.first(where: { $0.id == "remote" }))
    }
}
