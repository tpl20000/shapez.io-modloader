import "./core/polyfills";
import "./core/assert";
import "./core/error_handler";

import { createLogger, logSection } from "./core/logging";
import { Application } from "./application";
import { IS_DEBUG } from "./core/config";
import { addVanillaComponentsToAPI, initComponentRegistry } from "./game/component_registry";
import { initDrawUtils } from "./core/draw_utils";
import { initItemRegistry } from "./game/item_registry";
import { addVanillaBuildingsToAPI, initMetaBuildingRegistry } from "./game/meta_building_registry";
import { initGameSpeedRegistry } from "./game/game_speed_registry";
import { ModManager } from "./modloader/mod";
import { addVanillaSystemsToAPI } from "./game/game_system_manager";
const logger = createLogger("main");
(async() => {
    if (window.coreThreadLoadedCb) {
        logger.log("Javascript parsed, calling html thread");
        window.coreThreadLoadedCb();
    }

    // Logrocket
    // if (!G_IS_DEV && !G_IS_STANDALONE) {
    //     const monthlyUsers = 300; // thousand
    //     const logrocketLimit = 10; // thousand
    //     const percentageOfUsers = logrocketLimit / monthlyUsers;

    //     if (Math.random() <= percentageOfUsers) {
    //         logger.log("Analyzing this session with logrocket");
    //         const logrocket = require("logrocket");
    //         logrocket.init("p1x9zh/shapezio");

    //         try {
    //             logrocket.getSessionURL(function (sessionURL) {
    //                 logger.log("Connected lockrocket to GA");
    //                 // @ts-ignore
    //                 try {
    //                     window.ga("send", {
    //                         hitType: "event",
    //                         eventCategory: "LogRocket",
    //                         eventAction: sessionURL,
    //                     });
    //                 } catch (ex) {
    //                     logger.warn("Logrocket connection to analytics failed:", ex);
    //                 }
    //             });
    //         } catch (ex) {
    //             logger.warn("Logrocket connection to analytics failed:", ex);
    //         }
    //     }
    // }

    console.log(
        `%cshapez.io ️%c\n© 2020 Tobias Springer IT Solutions\nCommit %c${G_BUILD_COMMIT_HASH}%c on %c${new Date(
            G_BUILD_TIME
        ).toLocaleString()}\n`,
        "font-size: 35px; font-family: Arial;font-weight: bold; padding: 10px 0;",
        "color: #aaa",
        "color: #7f7",
        "color: #aaa",
        "color: #7f7"
    );

    console.log("Environment: %c" + G_APP_ENVIRONMENT, "color: #fff");

    if (G_IS_DEV && IS_DEBUG) {
        console.log("\n%c🛑 DEBUG ENVIRONMENT 🛑\n", "color: #f77");
    }

    /* typehints:start */
    // @ts-ignore
    assert(false, "typehints built in, this should never be the case!");
    /* typehints:end */

    /* dev:start */
    console.log("%cDEVCODE BUILT IN", "color: #f77");
    /* dev:end */

    logSection("Boot Process", "#f9a825");

    var modMgr = new ModManager();
    addVanillaBuildingsToAPI();
    addVanillaComponentsToAPI();
    addVanillaSystemsToAPI();
    await modMgr.addMods([
        "http://thomasbrants.nl:3000/mods/test_mods/mod1/modloader/bundle.js",
        "http://thomasbrants.nl:3000/mods/test_mods/test_mod2.js",
        "http://thomasbrants.nl:3000/mods/test_mods/test_mod3.js",
    ]);
    modMgr.loadMods();

    initDrawUtils();
    initComponentRegistry();
    initItemRegistry();
    initMetaBuildingRegistry();
    initGameSpeedRegistry();

    let app = null;

    function bootApp() {
        logger.log("Page Loaded");
        app = new Application();
        app.boot();
    }
    bootApp();
})();