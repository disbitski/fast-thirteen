import SwiftUI
#if !os(watchOS)
import Charts
#endif

struct FastThirteenRootView: View {
    @EnvironmentObject private var store: FastThirteenStore

    var body: some View {
        TabView {
            TrackerView()
                .tabItem { Label("Tracker", systemImage: "timer") }
#if !os(watchOS)
            FastDashboardView()
                .tabItem { Label("Dashboard", systemImage: "chart.bar.fill") }
#endif
            FastHistoryView()
                .tabItem { Label("History", systemImage: "clock.arrow.circlepath") }
            FastSettingsView()
                .tabItem { Label("Settings", systemImage: "gearshape") }
        }
        .preferredColorScheme(store.theme.colorScheme)
        .tint(store.theme.tint)
    }
}

struct TrackerView: View {
    @EnvironmentObject private var store: FastThirteenStore

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 24) {
                    Text("FAST THIRTEEN")
                        .font(.caption.weight(.bold))
                        .foregroundStyle(.tint)

                    if let session = store.activeSession {
                        TimelineView(.periodic(from: .now, by: 30)) { context in
                            ActiveFastCard(session: session, now: context.date)
                        }
                        Button("End fast", role: .destructive) { store.endFast() }
                            .buttonStyle(.borderedProminent)
                            .controlSize(.large)
                    } else {
                        VStack(spacing: 10) {
                            Image(systemName: "moon.stars.fill")
                                .font(.system(size: 42))
                                .foregroundStyle(.tint)
                            Text("Ready when you are.")
                                .font(.title2.weight(.bold))
                            Text("Your next fast is set for \(store.targetHours, specifier: "%.1f") hours.")
                                .foregroundStyle(.secondary)
                        }
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 48)
                        Button("Start fast") { store.startFast() }
                            .buttonStyle(.borderedProminent)
                            .controlSize(.large)
                    }

                    Text(store.state.message)
                        .font(.footnote)
                        .foregroundStyle(store.state == .loading ? .secondary : .tertiary)
                        .multilineTextAlignment(.center)
                }
                .frame(maxWidth: 560)
                .padding()
            }
            .navigationTitle("Tracker")
        }
    }
}

private struct ActiveFastCard: View {
    let session: FastingSession
    let now: Date

    var body: some View {
        let elapsed = session.elapsed(at: now)
        let target = session.targetHours * 3_600
        VStack(spacing: 12) {
            Text("FAST IN PROGRESS")
                .font(.caption.weight(.bold))
                .foregroundStyle(.tint)
            Text(FastTimeFormatter.duration(elapsed))
                .font(.system(size: 46, weight: .bold, design: .rounded).monospacedDigit())
            ProgressView(value: min(elapsed / target, 1))
                .tint(elapsed >= target ? .green : .accentColor)
            Text("\(session.targetHours, specifier: "%.1f")-hour goal · ends \(session.startedAt.addingTimeInterval(target), format: .dateTime.hour().minute())")
                .font(.footnote)
                .foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity)
        .padding(28)
        .background(.thinMaterial, in: RoundedRectangle(cornerRadius: 24))
    }
}

#if !os(watchOS)
struct FastDashboardView: View {
    @EnvironmentObject private var store: FastThirteenStore

    private var recentSessions: [FastingSession] {
        Array(store.completedSessions.prefix(7).reversed())
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 20) {
                    LazyVGrid(columns: [GridItem(.adaptive(minimum: 150), spacing: 12)], spacing: 12) {
                        FastMetricCard(
                            label: "Current streak",
                            value: "\(store.insights.currentStreakDays) days",
                            icon: "flame.fill"
                        )
                        FastMetricCard(
                            label: "Completed fasts",
                            value: "\(store.insights.completedCount)",
                            icon: "checkmark.circle.fill"
                        )
                        FastMetricCard(
                            label: "Total fasting",
                            value: String(format: "%.1f hr", store.insights.totalHours),
                            icon: "sum"
                        )
                        FastMetricCard(
                            label: "Average fast",
                            value: String(format: "%.1f hr", store.insights.averageHours),
                            icon: "chart.line.uptrend.xyaxis"
                        )
                        FastMetricCard(
                            label: "Goals reached",
                            value: store.insights.goalHitRate.formatted(.percent.precision(.fractionLength(0))),
                            icon: "target"
                        )
                    }

                    VStack(alignment: .leading, spacing: 12) {
                        Text("Recent rhythm")
                            .font(.title2.weight(.bold))
                        Text("Your seven most recent completed fasts compared with the current \(store.targetHours, specifier: "%.1f")-hour goal.")
                            .font(.subheadline)
                            .foregroundStyle(.secondary)

                        if recentSessions.isEmpty {
                            ContentUnavailableView(
                                "No completed fasts",
                                systemImage: "chart.bar",
                                description: Text("Finish a fast to start building your dashboard.")
                            )
                            .frame(maxWidth: .infinity, minHeight: 180)
                        } else {
                            Chart(recentSessions) { session in
                                BarMark(
                                    x: .value("Date", session.startedAt, unit: .day),
                                    y: .value("Hours", session.elapsed() / 3_600)
                                )
                                .foregroundStyle(store.theme.tint.gradient)

                                RuleMark(y: .value("Goal", store.targetHours))
                                    .foregroundStyle(.secondary)
                                    .lineStyle(StrokeStyle(lineWidth: 1, dash: [5]))
                            }
                            .chartYAxisLabel("Hours")
                            .frame(height: 220)
                        }
                    }
                    .padding(18)
                    .background(.thinMaterial, in: RoundedRectangle(cornerRadius: 20))
                }
                .frame(maxWidth: 900)
                .padding()
            }
            .navigationTitle("Dashboard")
        }
    }
}

private struct FastMetricCard: View {
    let label: String
    let value: String
    let icon: String

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Image(systemName: icon)
                .font(.title2)
                .foregroundStyle(.tint)
            Text(value)
                .font(.title2.weight(.bold).monospacedDigit())
            Text(label)
                .font(.caption)
                .foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(16)
        .background(.thinMaterial, in: RoundedRectangle(cornerRadius: 18))
    }
}
#endif

struct FastHistoryView: View {
    @EnvironmentObject private var store: FastThirteenStore
    @State private var editingSession: FastingSession?

    var body: some View {
        NavigationStack {
            List {
                if store.completedSessions.isEmpty {
                    ContentUnavailableView("No completed fasts", systemImage: "clock", description: Text("Finish your first fast and it will appear here."))
                } else {
                    ForEach(store.completedSessions) { session in
                        Button {
                            editingSession = session
                        } label: {
                            HStack(spacing: 12) {
                                VStack(alignment: .leading, spacing: 5) {
                                    Text(session.startedAt, format: .dateTime.month().day().year())
                                        .font(.headline)
                                    Text("\(FastTimeFormatter.duration(session.elapsed())) · \(session.targetHours, specifier: "%.1f")-hour goal")
                                        .foregroundStyle(.secondary)
                                }
                                Spacer()
                                Label("Edit", systemImage: "pencil")
                                    .labelStyle(.iconOnly)
                                    .foregroundStyle(.tint)
                            }
                            .contentShape(Rectangle())
                        }
                        .buttonStyle(.plain)
                        .accessibilityHint("Opens start and end time correction")
                    }
                }
            }
            .navigationTitle("History")
        }
        .sheet(item: $editingSession) { session in
            FastSessionEditor(session: session)
                .environmentObject(store)
        }
    }
}

private struct FastSessionEditor: View {
    @Environment(\.dismiss) private var dismiss
    @EnvironmentObject private var store: FastThirteenStore
    let session: FastingSession

    @State private var startedAt: Date
    @State private var endedAt: Date
    @State private var showDeleteConfirmation = false

    init(session: FastingSession) {
        self.session = session
        _startedAt = State(initialValue: session.startedAt)
        _endedAt = State(initialValue: session.endedAt ?? .now)
    }

    private var canSave: Bool {
        endedAt > startedAt && endedAt <= .now
    }

    var body: some View {
        NavigationStack {
            Form {
                Section("Correct timestamps") {
                    DatePicker("Started", selection: $startedAt, displayedComponents: [.date, .hourAndMinute])
                    DatePicker("Ended", selection: $endedAt, in: ...Date.now, displayedComponents: [.date, .hourAndMinute])
                }

                Section("Updated duration") {
                    LabeledContent("Fasting time", value: FastTimeFormatter.duration(endedAt.timeIntervalSince(startedAt)))
                    Text("Corrections update dashboard totals and sync to your other devices.")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                }

                Section {
                    Button("Delete fast", role: .destructive) {
                        showDeleteConfirmation = true
                    }
                } footer: {
                    Text("Deletion syncs as a tombstone so this fast stays removed everywhere.")
                }
            }
            .navigationTitle("Edit fast")
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Save") {
                        if store.correctSession(id: session.id, startedAt: startedAt, endedAt: endedAt) {
                            dismiss()
                        }
                    }
                    .disabled(!canSave)
                }
            }
            .alert("Delete this fast?", isPresented: $showDeleteConfirmation) {
                Button("Cancel", role: .cancel) {}
                Button("Delete fast", role: .destructive) {
                    if store.deleteSession(id: session.id) {
                        dismiss()
                    }
                }
            } message: {
                Text("This removes the fast from history and updates every Cloudflare-connected device.")
            }
        }
        .frame(minWidth: 360, minHeight: 420)
    }
}

struct FastSettingsView: View {
    @EnvironmentObject private var store: FastThirteenStore
    @State private var syncKey = ""

    var body: some View {
        NavigationStack {
            Form {
                Section("Fasting target") {
                    Stepper(
                        "\(store.targetHours, specifier: "%.1f") hours",
                        value: Binding(
                            get: { store.targetHours },
                            set: { store.updateTarget(hours: $0) }
                        ),
                        in: 1 ... 48,
                        step: 0.5
                    )
                    Text("This goal is captured when you start a new fast.")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                }

                Section("Appearance") {
                    Picker("Theme", selection: Binding(
                        get: { store.theme },
                        set: { store.selectTheme($0) }
                    )) {
                        ForEach(FastThirteenTheme.allCases) { theme in
                            Text(theme.title).tag(theme)
                        }
                    }
#if !os(watchOS)
                    .pickerStyle(.menu)
#endif

                    Text(store.theme.detail)
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                }

                Section("Data location") {
                    Picker("Fasting data", selection: Binding(
                        get: { store.dataSource },
                        set: { source in Task { await store.selectDataSource(source) } }
                    )) {
                        ForEach(TrackerDataSource.allCases) { source in
                            Text(source.title).tag(source)
                        }
                    }
#if !os(watchOS)
                    .pickerStyle(.menu)
#endif

                    Text(store.dataSource.detail)
                        .font(.footnote)
                        .foregroundStyle(.secondary)

                    if store.dataSource == .cloud {
                        LabeledContent("Cloud API", value: FastThirteenCloud.origin.host() ?? "Cloudflare")
                        SecureField("Private sync key", text: $syncKey)
                            .textContentType(.password)
                        Button(store.hasCloudSyncKey ? "Replace sync key" : "Save sync key") {
                            Task { await store.saveCloudSyncKey(syncKey) }
                        }
                        Button("Refresh from Cloudflare") {
                            Task { await store.refreshFromCloud() }
                        }
                    }
                }

                Section("Apple Health") {
                    Label("Fasting stays in Fast Thirteen", systemImage: "heart.text.square")
                    Text("Apple Health does not currently offer a fasting-session record type. This app will not write your fasts as unrelated nutrition, workout, or mindfulness data.")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                }

                Section("About") {
                    NavigationLink {
                        FastThirteenAboutView()
                    } label: {
                        Label("About Fast Thirteen", systemImage: "info.circle")
                    }
                }
            }
            .navigationTitle("Settings")
        }
    }
}

struct FastThirteenAboutView: View {
    var body: some View {
        ScrollView {
            VStack(spacing: 18) {
                Image(systemName: "timer.circle.fill")
                    .font(.system(size: 72))
                    .symbolRenderingMode(.palette)
                    .foregroundStyle(.tint, .quaternary)

                Text("Fast Thirteen")
                    .font(.largeTitle.weight(.bold))

                Text("A focused fasting tracker that makes a daily 13-hour rhythm simple across Mac, iPhone, Apple Watch, and the web.")
                    .foregroundStyle(.secondary)
                    .multilineTextAlignment(.center)

                Link(destination: URL(string: "https://thedavedev.com/")!) {
                    Label("Follow Dave online at thedavedev.com", systemImage: "arrow.up.right.square")
                        .font(.headline)
                }

                Text("Version \(Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "1.0")")
                    .font(.footnote)
                    .foregroundStyle(.tertiary)
            }
            .frame(maxWidth: 520)
            .padding(28)
        }
        .navigationTitle("About")
    }
}

extension FastThirteenTheme {
    var colorScheme: ColorScheme? {
        switch self {
        case .system: nil
        case .light: .light
        case .cyan, .purple, .spaceX: .dark
        }
    }

    var tint: Color {
        switch self {
        case .system, .light: .blue
        case .cyan: Color(red: 0.10, green: 0.82, blue: 1.00)
        case .purple: Color(red: 0.65, green: 0.33, blue: 1.00)
        case .spaceX: Color(red: 1.00, green: 0.38, blue: 0.08)
        }
    }
}

enum FastTimeFormatter {
    static func duration(_ interval: TimeInterval) -> String {
        let totalSeconds = max(0, Int(interval.rounded(.down)))
        return String(format: "%02d:%02d", totalSeconds / 3_600, (totalSeconds % 3_600) / 60)
    }
}
