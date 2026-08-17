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
