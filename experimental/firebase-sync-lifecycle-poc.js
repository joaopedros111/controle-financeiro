// Explicit harness composition only. Never imported by the published application.
import { createAuthEmulatorPocSession } from './auth-emulator-poc-session.js';

export function composeFirebaseSyncLifecycle({ client, auth, sdk, allowedUids, revocations, createLifecycle }) {
    let observer, subscribed = false, disposed = false, deliveryEpoch = 0, experimentalFailed = false;
    let sdkLogout = Promise.resolve();
    const errors = [];
    const session = createAuthEmulatorPocSession({ auth, allowedUids, revocations, createLifecycle,
        sdk: { ...sdk, onAuthStateChanged(_auth, callback) {
            observer = callback;
            return () => {}; // The real subscription belongs to the legacy consumer.
        } }, signOut: () => sdkLogout });
    function deliver(user, epoch) {
        if (disposed || experimentalFailed || epoch !== deliveryEpoch || user !== auth.currentUser) return;
        // Lifecycle failures never escape through the SDK callback or delay legacy delivery.
        try { observer(user); } catch (error) { errors.push(error); }
    }
    session.ready.catch(error => errors.push(error));
    const decorated = { ...client,
        onUser(callback) {
            if (subscribed || disposed) throw new Error('One PoC subscription per composition required');
            subscribed = true;
            const unsubscribe = client.onUser(user => {
                if (disposed) return;
                const epoch = deliveryEpoch;
                try { return callback(user); }
                catch (error) {
                    experimentalFailed = true; deliveryEpoch++;
                    void session.dispose().catch(cause => errors.push(cause));
                    throw error;
                }
                finally { queueMicrotask(() => deliver(user, epoch)); }
            });
            let cancelled = false;
            return () => {
                if (cancelled) return;
                cancelled = disposed = true; deliveryEpoch++;
                // Invalidates locally before removing the existing SDK subscription.
                void session.dispose().catch(error => errors.push(error));
                return unsubscribe();
            };
        },
        // Revoke locally before the original signOut. Login retains its gesture semantics.
        logout() {
            deliveryEpoch++;
            // Local revocation starts synchronously, but an observational Lifecycle
            // must not delay or replace the existing SDK logout result.
            void session.logout().catch(error => errors.push(error));
            try { sdkLogout = Promise.resolve(client.logout()); }
            catch (error) { sdkLogout = Promise.reject(error); }
            sdkLogout.catch(() => {});
            return sdkLogout;
        }
    };
    return { client: decorated, session, errors };
}
