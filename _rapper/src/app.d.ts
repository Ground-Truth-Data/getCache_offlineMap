// rapper is a headless frontend - no auth, no direct DB access
declare global {
    namespace App {
        interface Locals {
        }

        namespace Superforms {
            interface Message {}
        }

        interface PageData {
            flash?: Record<string, unknown> | string;
        }
    }
}

export {};
