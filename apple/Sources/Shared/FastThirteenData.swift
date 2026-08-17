import Foundation

enum TrackerDataSource: String, CaseIterable, Codable, Identifiable {
    case cloud
    case local

    var id: String { rawValue }

    var title: String {
        switch self {
        case .cloud: "Cloudflare sync"
        case .local: "This device only"
        }
    }

    var detail: String {
        switch self {
        case .cloud: "Keeps an offline copy and securely syncs history from anywhere."
        case .local: "Keeps fasting history only on this device."
        }
    }
}

enum FastThirteenTheme: String, CaseIterable, Identifiable {
    case system
    case cyan
    case purple
    case spaceX = "spacex"
    case light

    var id: String { rawValue }

    var title: String {
        switch self {
        case .system: "System"
        case .cyan: "Cyan"
        case .purple: "Purple"
        case .spaceX: "SpaceX"
        case .light: "Light"
        }
    }

    var detail: String {
        switch self {
        case .system: "Follows this device's appearance."
        case .cyan: "Black with electric cyan highlights."
        case .purple: "Black with vivid purple highlights."
        case .spaceX: "Black with launch-orange highlights."
        case .light: "Bright surfaces with crisp blue highlights."
        }
    }
}

enum FastThirteenCloud {
    static let origin = URL(string: "https://fast-api.thedavedev.com")!
    static let dataURL = origin.appending(path: "v1/data")
}

struct FastingSettings: Codable, Equatable {
    var targetHours: Double = 13
}

struct FastThirteenProfile: Codable, Equatable {
    var mode: String = "guest"
    var guestId: String = "local-guest"
    var userId: String?
    var email: String?
    var displayName: String = "Guest"
    var provider: String?
    var updatedAt: Date = Date(timeIntervalSince1970: 0)
}

struct FastThirteenSync: Codable, Equatable {
    var status: String = "local"
    var lastSyncedAt: Date?
    var lastError: String?
    var updatedAt: Date = Date(timeIntervalSince1970: 0)
}

struct FastingSession: Codable, Equatable, Identifiable {
    let id: String
    var startedAt: Date
    var endedAt: Date?
    var targetHours: Double
    var updatedAt: Date
    var deletedAt: Date?

    var isActive: Bool { endedAt == nil && deletedAt == nil }
    var isDeleted: Bool { deletedAt != nil }

    func elapsed(at date: Date = .now) -> TimeInterval {
        max(0, (endedAt ?? date).timeIntervalSince(startedAt))
    }
}

enum FastingSessionEditError: LocalizedError, Equatable {
    case futureEnd
    case invalidRange
    case notEditable

    var errorDescription: String? {
        switch self {
        case .futureEnd: "A completed fast cannot end in the future."
        case .invalidRange: "End time must be after start time."
        case .notEditable: "This fast is no longer available to edit."
        }
    }
}

struct FastingInsights: Equatable {
    var completedCount: Int
    var currentStreakDays: Int
    var totalHours: Double
    var averageHours: Double
    var goalHitRate: Double
}

struct FastThirteenData: Codable, Equatable {
    var version: Int = 3
    var settings: FastingSettings = .init()
    var profile: FastThirteenProfile = .init()
    var sync: FastThirteenSync = .init()
    var sessions: [FastingSession] = []

    var activeSession: FastingSession? {
        sessions.first(where: \.isActive)
    }

    var completedSessions: [FastingSession] {
        sessions
            .filter { !$0.isDeleted && $0.endedAt != nil }
            .sorted { $0.startedAt > $1.startedAt }
    }

    mutating func correctSession(
        id: String,
        startedAt: Date,
        endedAt: Date,
        updatedAt: Date = .now
    ) throws {
        guard let index = sessions.firstIndex(where: { $0.id == id }),
              sessions[index].endedAt != nil,
              !sessions[index].isDeleted else {
            throw FastingSessionEditError.notEditable
        }
        guard endedAt > startedAt else {
            throw FastingSessionEditError.invalidRange
        }
        guard endedAt <= updatedAt else {
            throw FastingSessionEditError.futureEnd
        }

        sessions[index].startedAt = startedAt
        sessions[index].endedAt = endedAt
        sessions[index].updatedAt = updatedAt
    }

    mutating func deleteSession(id: String, deletedAt: Date = .now) throws {
        guard let index = sessions.firstIndex(where: { $0.id == id }),
              sessions[index].endedAt != nil,
              !sessions[index].isDeleted else {
            throw FastingSessionEditError.notEditable
        }

        sessions[index].deletedAt = deletedAt
        sessions[index].updatedAt = deletedAt
    }

    func insights(at now: Date = .now, calendar: Calendar = .current) -> FastingInsights {
        let completed = completedSessions
        let totalSeconds = completed.reduce(0) { $0 + $1.elapsed() }
        let totalHours = totalSeconds / 3_600
        let averageHours = completed.isEmpty ? 0 : totalHours / Double(completed.count)
        let goalsMet = completed.filter { $0.elapsed() >= $0.targetHours * 3_600 }.count
        let goalHitRate = completed.isEmpty ? 0 : Double(goalsMet) / Double(completed.count)
        let completedDays = Set(completed.compactMap { session in
            session.endedAt.map { calendar.startOfDay(for: $0) }
        })

        let today = calendar.startOfDay(for: now)
        var day = completedDays.contains(today)
            ? today
            : calendar.date(byAdding: .day, value: -1, to: today) ?? today
        var currentStreakDays = 0

        while completedDays.contains(day) {
            currentStreakDays += 1
            guard let previous = calendar.date(byAdding: .day, value: -1, to: day) else { break }
            day = previous
        }

        return FastingInsights(
            completedCount: completed.count,
            currentStreakDays: currentStreakDays,
            totalHours: totalHours,
            averageHours: averageHours,
            goalHitRate: goalHitRate
        )
    }

    func merged(with remote: FastThirteenData) -> FastThirteenData {
        var sessionsByID = Dictionary(uniqueKeysWithValues: sessions.map { ($0.id, $0) })

        for remoteSession in remote.sessions {
            guard let localSession = sessionsByID[remoteSession.id] else {
                sessionsByID[remoteSession.id] = remoteSession
                continue
            }

            if remoteSession.updatedAt > localSession.updatedAt ||
                (remoteSession.updatedAt == localSession.updatedAt && remoteSession.deletedAt != nil && localSession.deletedAt == nil) {
                sessionsByID[remoteSession.id] = remoteSession
            }
        }

        var merged = self
        merged.sessions = sessionsByID.values.sorted { $0.startedAt > $1.startedAt }
        return merged
    }
}

enum FastThirteenJSON {
    static func decode(_ data: Data) throws -> FastThirteenData {
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .custom { decoder in
            let container = try decoder.singleValueContainer()
            let value = try container.decode(String.self)
            if let date = fastThirteenDateFormatter().date(from: value) {
                return date
            }
            throw DecodingError.dataCorruptedError(in: container, debugDescription: "Expected an ISO-8601 date.")
        }
        return try decoder.decode(FastThirteenData.self, from: data)
    }

    static func encode(_ value: FastThirteenData) throws -> Data {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
        encoder.dateEncodingStrategy = .custom { date, encoder in
            var container = encoder.singleValueContainer()
            try container.encode(fastThirteenDateFormatter().string(from: date))
        }
        return try encoder.encode(value)
    }
}

private func fastThirteenDateFormatter() -> ISO8601DateFormatter {
    let formatter = ISO8601DateFormatter()
    formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    return formatter
}
