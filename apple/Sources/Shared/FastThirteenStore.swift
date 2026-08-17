import Combine
import Foundation

enum TrackerStoreState: Equatable {
    case ready(String)
    case loading
    case unavailable(String)

    var message: String {
        switch self {
        case let .ready(message), let .unavailable(message): message
        case .loading: "Connecting to Cloudflare..."
        }
    }
}

@MainActor
final class FastThirteenStore: ObservableObject {
    @Published private(set) var data: FastThirteenData
    @Published private(set) var dataSource: TrackerDataSource
    @Published private(set) var state: TrackerStoreState
    @Published private(set) var hasCloudSyncKey: Bool
    @Published private(set) var theme: FastThirteenTheme

    private let defaults: UserDefaults
    private var cloudSyncKey: String
    private static let dataKey = "fast-thirteen.apple.data"
    private static let sourceKey = "fast-thirteen.apple.data-source"
    private static let themeKey = "fast-thirteen.apple.theme"

    init(defaults: UserDefaults = .standard) {
        let syncKey = CloudSyncKeyStore.load()
        self.defaults = defaults
        self.data = Self.readLocalData(from: defaults)
        self.dataSource = TrackerDataSource(rawValue: defaults.string(forKey: Self.sourceKey) ?? "") ?? .cloud
        self.state = .ready("Ready on this device")
        self.cloudSyncKey = syncKey
        self.hasCloudSyncKey = !syncKey.isEmpty
        self.theme = FastThirteenTheme(rawValue: defaults.string(forKey: Self.themeKey) ?? "") ?? .system
    }

    var activeSession: FastingSession? { data.activeSession }
    var completedSessions: [FastingSession] { data.completedSessions }
    var targetHours: Double { data.settings.targetHours }
    var insights: FastingInsights { data.insights() }

    func startFast(at date: Date = .now) {
        guard activeSession == nil else { return }
        let session = FastingSession(
            id: "fast-\(UUID().uuidString.lowercased())",
            startedAt: date,
            endedAt: nil,
            targetHours: data.settings.targetHours,
            updatedAt: date,
            deletedAt: nil
        )
        data.sessions.insert(session, at: 0)
        persistAndSync("Fast started and saved on this device")
    }

    func endFast(at date: Date = .now) {
        guard let index = data.sessions.firstIndex(where: \.isActive) else { return }
        data.sessions[index].endedAt = max(date, data.sessions[index].startedAt)
        data.sessions[index].updatedAt = date
        persistAndSync("Fast ended and saved on this device")
    }

    func updateTarget(hours: Double) {
        data.settings.targetHours = min(48, max(1, (hours * 2).rounded() / 2))
        persistAndSync("Goal saved on this device")
    }

    func selectTheme(_ theme: FastThirteenTheme) {
        self.theme = theme
        defaults.set(theme.rawValue, forKey: Self.themeKey)
    }

    func selectDataSource(_ source: TrackerDataSource) async {
        dataSource = source
        defaults.set(source.rawValue, forKey: Self.sourceKey)

        guard source == .cloud else {
            state = .ready("Using this device only")
            return
        }

        await refreshFromCloud()
    }

    func saveCloudSyncKey(_ value: String) async {
        guard CloudSyncKeyStore.save(value) else {
            state = .unavailable("The private sync key could not be saved in Keychain")
            return
        }
        cloudSyncKey = value.trimmingCharacters(in: .whitespacesAndNewlines)
        hasCloudSyncKey = !cloudSyncKey.isEmpty
        if hasCloudSyncKey && dataSource == .cloud {
            await refreshFromCloud()
        } else {
            state = .ready("Private sync key removed; using the offline copy")
        }
    }

    func refreshFromCloud() async {
        guard dataSource == .cloud else {
            state = .ready("Using this device only")
            return
        }
        guard hasCloudSyncKey else {
            state = .unavailable("Add your private sync key in Settings to enable Cloudflare")
            return
        }

        state = .loading
        do {
            let remote = try await readServerData()
            if let remote {
                data = data.merged(with: remote)
                persistLocal()
                state = .ready("Cloud data refreshed; this device keeps an offline copy")
            } else {
                try await writeServerData()
                state = .ready("Cloud storage was empty; this device created the first shared copy")
            }
        } catch {
            state = .unavailable("Cloud sync is unavailable; your local history is safe")
        }
    }

    private func persistAndSync(_ localMessage: String) {
        persistLocal()
        state = .ready(localMessage)

        guard dataSource == .cloud, hasCloudSyncKey else { return }
        Task { await syncChangesToCloud() }
    }

    private func syncChangesToCloud() async {
        do {
            try await writeServerData()
            state = .ready("Saved in Cloudflare and on this device")
        } catch {
            state = .unavailable("Saved on this device; cloud sync is unavailable")
        }
    }

    private func persistLocal() {
        guard let encoded = try? FastThirteenJSON.encode(data) else { return }
        defaults.set(encoded, forKey: Self.dataKey)
    }

    private func readServerData() async throws -> FastThirteenData? {
        var request = URLRequest(url: FastThirteenCloud.dataURL)
        request.setValue("Bearer \(cloudSyncKey)", forHTTPHeaderField: "Authorization")
        let (payload, response) = try await URLSession.shared.data(for: request)
        guard let http = response as? HTTPURLResponse, http.statusCode == 200 else {
            throw URLError(.badServerResponse)
        }
        let envelope = try JSONSerialization.jsonObject(with: payload) as? [String: Any]
        guard let dataValue = envelope?["data"], !(dataValue is NSNull) else { return nil }
        let data = try JSONSerialization.data(withJSONObject: dataValue)
        return try FastThirteenJSON.decode(data)
    }

    private func writeServerData() async throws {
        var request = URLRequest(url: FastThirteenCloud.dataURL)
        request.httpMethod = "PUT"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("Bearer \(cloudSyncKey)", forHTTPHeaderField: "Authorization")
        request.httpBody = try FastThirteenJSON.encode(data)
        let (_, response) = try await URLSession.shared.data(for: request)
        guard let http = response as? HTTPURLResponse, (200 ..< 300).contains(http.statusCode) else {
            throw URLError(.badServerResponse)
        }
    }

    private static func readLocalData(from defaults: UserDefaults) -> FastThirteenData {
        guard let payload = defaults.data(forKey: dataKey),
              let decoded = try? FastThirteenJSON.decode(payload) else {
            return .init()
        }
        return decoded
    }
}
