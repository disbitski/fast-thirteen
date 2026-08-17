import SwiftUI

@main
struct FastThirteenIOSApp: App {
    @StateObject private var store = FastThirteenStore()

    var body: some Scene {
        WindowGroup {
            FastThirteenRootView()
                .environmentObject(store)
                .task { await store.refreshFromCloud() }
        }
    }
}
