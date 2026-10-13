import { migrateLegacyStorage } from "./legacyStorage";

// Import this first in every page entry: later modules read storage as they load.
if (typeof localStorage !== "undefined") migrateLegacyStorage(localStorage);
