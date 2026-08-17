import SwiftUI

@main
struct FastThirteenMacApp: App {
    @StateObject private var store = FastThirteenStore()

    var body: some Scene {
        WindowGroup {
            FastThirteenRootView()
                .environmentObject(store)
                .frame(minWidth: 700, minHeight: 560)
                .task { await store.refreshFromCloud() }
        }
    }
}
