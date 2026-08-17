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

    func testInsightsCalculateTotalsGoalsAndCurrentStreak() {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(secondsFromGMT: 0)!
        let today = calendar.startOfDay(for: Date(timeIntervalSince1970: 1_786_915_200))
        let now = today.addingTimeInterval(12 * 3_600)
        let yesterday = calendar.date(byAdding: .day, value: -1, to: today)!
        let sessions = [
            FastingSession(
                id: "today",
                startedAt: today.addingTimeInterval(-6 * 3_600),
                endedAt: today.addingTimeInterval(8 * 3_600),
                targetHours: 13,
                updatedAt: now,
                deletedAt: nil
            ),
            FastingSession(
                id: "yesterday",
                startedAt: yesterday.addingTimeInterval(-4 * 3_600),
                endedAt: yesterday.addingTimeInterval(8 * 3_600),
                targetHours: 13,
                updatedAt: now,
                deletedAt: nil
            )
        ]

        let insights = FastThirteenData(sessions: sessions).insights(at: now, calendar: calendar)

        XCTAssertEqual(insights.completedCount, 2)
        XCTAssertEqual(insights.currentStreakDays, 2)
        XCTAssertEqual(insights.totalHours, 26, accuracy: 0.001)
        XCTAssertEqual(insights.averageHours, 13, accuracy: 0.001)
        XCTAssertEqual(insights.goalHitRate, 0.5, accuracy: 0.001)
    }

    func testCompletedSessionCorrectionAndDeletionPreserveCloudMergeSafety() throws {
        let originalStart = Date(timeIntervalSince1970: 10_000)
        let originalEnd = originalStart.addingTimeInterval(13 * 3_600)
        let correctedStart = originalStart.addingTimeInterval(900)
        let correctedEnd = originalEnd.addingTimeInterval(1_800)
        let correctionTime = correctedEnd.addingTimeInterval(60)
        let deletionTime = correctionTime.addingTimeInterval(60)
        let original = FastingSession(
            id: "editable",
            startedAt: originalStart,
            endedAt: originalEnd,
            targetHours: 13,
            updatedAt: originalEnd,
            deletedAt: nil
        )
        var data = FastThirteenData(sessions: [original])

        try data.correctSession(
            id: original.id,
            startedAt: correctedStart,
            endedAt: correctedEnd,
            updatedAt: correctionTime
        )

        XCTAssertEqual(data.sessions[0].startedAt, correctedStart)
        XCTAssertEqual(data.sessions[0].endedAt, correctedEnd)
        XCTAssertEqual(data.sessions[0].updatedAt, correctionTime)

        try data.deleteSession(id: original.id, deletedAt: deletionTime)

        XCTAssertEqual(data.sessions[0].deletedAt, deletionTime)
        XCTAssertEqual(data.sessions[0].updatedAt, deletionTime)
        XCTAssertTrue(data.merged(with: FastThirteenData(sessions: [original])).completedSessions.isEmpty)
    }
}
