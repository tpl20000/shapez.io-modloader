import { ReadWriteProxy } from "../core/read_write_proxy";
import { ExplainedResult } from "../core/explained_result";
import { SavegameSerializer } from "./savegame_serializer";
import { BaseSavegameInterface } from "./savegame_interface";
import { createLogger } from "../core/logging";
import { globalConfig } from "../core/config";
import { getSavegameInterface, savegameInterfaces } from "./savegame_interface_registry";
import { SavegameInterface_V1001 } from "./schemas/1001";
import { SavegameInterface_V1002 } from "./schemas/1002";
import { SavegameInterface_V1003 } from "./schemas/1003";
import { SavegameInterface_V1004 } from "./schemas/1004";
import { SavegameInterface_V1005 } from "./schemas/1005";
import { SavegameInterface_V1006 } from "./schemas/1006";
import { SavegameInterface_V1007 } from "./schemas/1007";
import { SavegameInterface_ML01 } from "./schemas/ML01";
import { RegularGameMode } from "../game/modes/regular";

const logger = createLogger("savegame");

export class Savegame extends ReadWriteProxy {
    /**
     *
     * @param {import("../application").Application} app
     * @param {object} param0
     * @param {string} param0.internalId
     * @param {import("./savegame_typedefs").SavegameMetadata} param0.metaDataRef Handle to the meta data
     */
    constructor(app, { internalId, metaDataRef }, gamemode = null) {
        super(app, "savegame-" + internalId + ".bin");
        this.internalId = internalId;
        this.metaDataRef = metaDataRef;

        /** @type {import("./savegame_typedefs").SavegameData} */
        this.currentData = this.getDefaultData();
        if (gamemode) this.currentData.gamemode = gamemode;
        assert(
            savegameInterfaces[Savegame.getCurrentVersion()],
            "Savegame interface not defined: " + Savegame.getCurrentVersion()
        );
    }

    //////// RW Proxy Impl //////////

    /**
     * @returns {any}
     */
    static getCurrentVersion() {
        return "ML01";
    }

    /**
     * @returns {typeof BaseSavegameInterface}
     */
    static getReaderClass() {
        return savegameInterfaces[Savegame.getCurrentVersion()];
    }

    /**
     * @returns {number}
     */
    getCurrentVersion() {
        return /** @type {typeof Savegame} */ (this.constructor).getCurrentVersion();
    }

    /**
     * Returns the savegames default data
     * @returns {import("./savegame_typedefs").SavegameData}
     */
    getDefaultData() {
        return {
            version: this.getCurrentVersion(),
            dump: null,
            stats: {},
            lastUpdate: Date.now(),
            gamemode: RegularGameMode.getId(),
        };
    }

    /**
     * Migrates the savegames data
     * @param {import("./savegame_typedefs").SavegameData} data
     */
    migrate(data) {
        if (data.version < 1000) {
            return ExplainedResult.bad("Can not migrate savegame, too old");
        }

        if (data.version === 1000) {
            SavegameInterface_V1001.migrate1000to1001(data);
            data.version = 1001;
        }

        if (data.version === 1001) {
            SavegameInterface_V1002.migrate1001to1002(data);
            data.version = 1002;
        }

        if (data.version === 1002) {
            SavegameInterface_V1003.migrate1002to1003(data);
            data.version = 1003;
        }

        if (data.version === 1003) {
            SavegameInterface_V1004.migrate1003to1004(data);
            data.version = 1004;
        }

        if (data.version === 1004) {
            SavegameInterface_V1005.migrate1004to1005(data);
            data.version = 1005;
        }

        if (data.version === 1005) {
            SavegameInterface_V1006.migrate1005to1006(data);
            data.version = 1006;
        }

        if (data.version === 1006) {
            SavegameInterface_V1007.migrate1006to1007(data);
            data.version = 1007;
        }

        if (data.version === 1007) {
            SavegameInterface_ML01.migrate1007toML01(data);
            data.version = "ML01";
        }

        return ExplainedResult.good();
    }

    /**
     * Verifies the savegames data
     * @param {import("./savegame_typedefs").SavegameData} data
     */
    verify(data) {
        if (!data.dump) {
            // Well, guess that works
            return ExplainedResult.good();
        }

        if (!this.getDumpReaderForExternalData(data).validate()) {
            return ExplainedResult.bad("dump-reader-failed-validation");
        }
        return ExplainedResult.good();
    }

    //////// Subclasses interface  ////////

    /**
     * Returns if this game can be saved on disc
     * @returns {boolean}
     */
    isSaveable() {
            return true;
        }
        /**
         * Returns the statistics of the savegame
         * @returns {import("./savegame_typedefs").SavegameStats}
         */
    getStatistics() {
        return this.currentData.stats;
    }

    /**
     * Returns the *real* last update of the savegame, not the one of the metadata
     * which could also be the servers one
     */
    getRealLastUpdate() {
        return this.currentData.lastUpdate;
    }

    /**
     * Returns if this game has a serialized game dump
     */
    hasGameDump() {
        return !!this.currentData.dump && this.currentData.dump.entities.length > 0;
    }

    /**
     * Returns the current game dump
     * @returns {import("./savegame_typedefs").SerializedGame}
     */
    getCurrentDump() {
        return this.currentData.dump;
    }

    /**
     * Returns a reader to access the data
     * @returns {BaseSavegameInterface}
     */
    getDumpReader() {
        if (!this.currentData.dump) {
            logger.warn("Getting reader on null-savegame dump");
        }

        const cls = /** @type {typeof Savegame} */ (this.constructor).getReaderClass();
        return new cls(this.currentData);
    }

    /**
     * Returns a reader to access external data
     * @returns {BaseSavegameInterface}
     */
    getDumpReaderForExternalData(data) {
        assert(data.version, "External data contains no version");
        return getSavegameInterface(data);
    }

    ///////// Public Interface ///////////

    /**
     * Updates the last update field so we can send the savegame to the server,
     * WITHOUT Saving!
     */
    setLastUpdate(time) {
        this.currentData.lastUpdate = time;
    }

    /**
     *
     * @param {import("../game/root").GameRoot} root
     */
    updateData(root) {
        // Construct a new serializer
        const serializer = new SavegameSerializer();

        // let timer = performance.now();
        const dump = serializer.generateDumpFromGameRoot(root);
        if (!dump) {
            return false;
        }

        const shadowData = Object.assign({}, this.currentData);
        shadowData.dump = dump;
        shadowData.lastUpdate = new Date().getTime();
        shadowData.version = this.getCurrentVersion();
        // @ts-ignore
        shadowData.gamemode = root.gameMode.constructor.getId();

        const reader = this.getDumpReaderForExternalData(shadowData);

        // Validate (not in prod though)
        if (!G_IS_RELEASE) {
            const validationResult = reader.validate();
            if (!validationResult) {
                return false;
            }
        }

        // Save data
        this.currentData = shadowData;
    }

    /**
     * Writes the savegame as well as its metadata
     */
    writeSavegameAndMetadata() {
        return this.writeAsync().then(() => this.saveMetadata());
    }

    /**
     * Updates the savegames metadata
     */
    saveMetadata() {
        this.metaDataRef.lastUpdate = new Date().getTime();
        this.metaDataRef.version = this.getCurrentVersion();
        if (!this.hasGameDump()) {
            this.metaDataRef.level = 0;
        } else {
            this.metaDataRef.level = this.currentData.dump.hubGoals.level;
        }

        return this.app.savegameMgr.writeAsync();
    }

    /**
     * @see ReadWriteProxy.writeAsync
     * @returns {Promise<any>}
     */
    writeAsync() {
        if (G_IS_DEV && globalConfig.debug.disableSavegameWrite) {
            return Promise.resolve();
        }
        return super.writeAsync();
    }
}