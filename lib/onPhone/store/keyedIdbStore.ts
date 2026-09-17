/** keyedIdbStore.ts — the IndexedDB wrapper for the offline boxes (one object store, no keyPath, explicit string keys). ⚠️ SHELL HEAL: a DB that exists but lacks its store throws "object store not found" forever until deleted + recreated on first open. */

import {
	currentDbName,
	registerOfflineDbReset,
} from "../../shared/sandboxDbNames";

export interface KeyedIdbStore<T> {
	get(key: string): Promise<T | undefined>;
	put(key: string, value: T): Promise<void>;
	delete(key: string): Promise<void>;
	/** Every stored key, as strings (keys are always explicit strings here). */
	keys(): Promise<string[]>;
	/** Every stored value. ⚠️ Deserializes the WHOLE store in one main-thread task — use getAllProjected for a big store. */
	getAll(): Promise<T[]>;
	/** Every stored value, cursor-streamed and reduced via project(value) so full records never all exist at once. */
	getAllProjected<P>(project: (value: T) => P): Promise<P[]>;
}

export function makeKeyedIdbStore<T>(opts: {
	dbName: string;
	storeName: string;
	version?: number;
}): KeyedIdbStore<T> {
	const { dbName, storeName, version = 1 } = opts;

	let dbPromise: Promise<IDBDatabase> | null = null;

	function openOnce(): Promise<IDBDatabase> {
		return new Promise<IDBDatabase>((resolve, reject) => {
			const req = indexedDB.open(currentDbName(dbName), version);
			req.onupgradeneeded = () => {
				const db = req.result;
				if (!db.objectStoreNames.contains(storeName))
					db.createObjectStore(storeName);
			};
			req.onsuccess = () => resolve(req.result);
			req.onerror = () => reject(req.error);
		});
	}

	function openDb(): Promise<IDBDatabase> {
		if (dbPromise) return dbPromise;
		dbPromise = (async () => {
			let db = await openOnce();
			// SHELL HEAL — see the file header.
			if (!db.objectStoreNames.contains(storeName)) {
				db.close();
				await new Promise<void>((res) => {
					const del = indexedDB.deleteDatabase(currentDbName(dbName));
					del.onsuccess = () => res();
					del.onerror = () => res();
					del.onblocked = () => res();
				});
				db = await openOnce();
			}
			return db;
		})();
		return dbPromise;
	}

	// ⚠️ Close the connection, don't just drop the reference — an open connection blocks deleteDatabase forever, which let a wipe report a store "clean" while it actually survived.
	registerOfflineDbReset(() => {
		const pending = dbPromise;
		dbPromise = null;
		void pending?.then((db) => db.close()).catch(() => {});
	});

	/** Run `body` in a transaction and settle on the TRANSACTION's outcome.
	 *
	 *  A request's `onerror` is not the whole story: a transaction that aborts —
	 *  another connection holds the database, a version change is pending, quota
	 *  is gone — fires `onabort` and leaves its requests silent, so a promise
	 *  resolved from request callbacks alone never settles. A tile read that
	 *  never settles is a map that never draws, with nothing thrown to see. */
	function inTx<R>(
		mode: IDBTransactionMode,
		body: (os: IDBObjectStore, done: (value: R) => void) => void,
	): Promise<R> {
		return openDb().then(
			(db) =>
				new Promise<R>((res, rej) => {
					const t = db.transaction(storeName, mode);
					let value: R;
					body(t.objectStore(storeName), (v) => {
						value = v;
					});
					t.oncomplete = () => res(value);
					t.onabort = () => rej(t.error ?? new Error(`[idb] ${storeName} transaction aborted`));
					t.onerror = () => rej(t.error);
				}),
		);
	}

	return {
		get(key: string): Promise<T | undefined> {
			return inTx("readonly", (os, done) => {
				const r = os.get(key);
				r.onsuccess = () => done(r.result as T | undefined);
			});
		},
		put(key: string, value: T): Promise<void> {
			return inTx("readwrite", (os) => {
				os.put(value, key);
			});
		},
		delete(key: string): Promise<void> {
			return inTx("readwrite", (os) => {
				os.delete(key);
			});
		},
		keys(): Promise<string[]> {
			return inTx("readonly", (os, done) => {
				const r = os.getAllKeys();
				r.onsuccess = () => done(r.result.map(String));
			});
		},
		/** ⚠️ project runs inside the IDB transaction: keep it pure and cheap, and never await in it or the transaction auto-closes. */
		getAllProjected<P>(project: (value: T) => P): Promise<P[]> {
			return inTx("readonly", (os, done) => {
				const out: P[] = [];
				done(out);
				const r = os.openCursor();
				r.onsuccess = () => {
					const cur = r.result;
					if (!cur) return;
					out.push(project(cur.value as T));
					cur.continue();
				};
			});
		},
		getAll(): Promise<T[]> {
			return inTx("readonly", (os, done) => {
				const r = os.getAll();
				r.onsuccess = () => done(r.result as T[]);
			});
		},
	};
}
