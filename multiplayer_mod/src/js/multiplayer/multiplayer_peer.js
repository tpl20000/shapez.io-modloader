import { MultiplayerBuilder } from "./multiplayer_builder";
import { enumNotificationType } from "./multiplayer_notification_types";
import {
    MultiplayerPacket,
    TextPacket,
    TextPacketTypes,
    SignalPacket,
    SignalPacketSignals,
    StringSerializable,
    DataPacket,
    FlagPacket,
    FlagPacketFlags,
    MultiplayerPacketTypes,
} from "./multiplayer_packets";

const { v4: uuidv4 } = require("uuid");
const wrtc = require("wrtc");
const Peer = require("simple-peer");
const io = require("socket.io-client");
const getBuildingDataFromCode = shapezAPI.exports.getBuildingDataFromCode;
const Dialog = shapezAPI.exports.Dialog;

const config = {
    iceServers: [
        {
            urls: "stun:stun.1.google.com:19302",
        },
        {
            urls: "turn:numb.viagenie.ca",
            credential: "muazkh",
            username: "webrtc@live.com",
        },
    ],
};

export class MultiplayerPeer {
    /**
     * @param {import ("../states/multiplayer_ingame").InMultiplayerGameState} ingameState
     * @param {Peer.Instance | null} peer
     */
    constructor(ingameState, peer = null) {
        this.ingameState = ingameState;
        this.multiplayerPlace = [];
        this.multiplayerDestroy = [];
        this.multipalyerComponentAdd = [];
        this.multipalyerComponentRemove = [];
        this.multipalyerUnlockUpgrade = [];
        this.multiplayerConstantSignalChange = [];

        this.user = {
            _id: uuidv4(),
            username: shapezAPI.user.username,
        };
        this.users = [];

        this.host = !!peer;
        if (this.host) {
            this.setupHost();
            this.connections = [];
        } else {
            this.peer = peer;
            this.setupClient(this.peer);
        }

        this.builder = new MultiplayerBuilder(this.ingameState, this);
    }

    setupHost() {
        this.connectionId = uuidv4();
        // @ts-ignore
        var socket = io(this.ingameState.host, { transport: ["websocket"] });
        var socketId = undefined;

        socket.on("connect", () => {
            //Get socket id
            socket.on("id", id => {
                socketId = id;
            });

            //Create room on server
            socket.emit("createRoom", this.connectionId);

            //Create peer
            socket.on("createPeer", async data => {
                this.createPeer(socket, socketId, data);
            });
        });

        socket.on("connect_error", () => {
            this.ingameState.onInitializationFailure("Failed to connect to server: " + this.ingameState.host);
        });

        //Show uuid of room
        let dialog = new Dialog({
            app: this.ingameState.app,
            title: shapezAPI.translations.multiplayer.shareCode,
            contentHTML: `
            <a id="share-connection-${this.connectionId}" onclick="function fallbackCopyTextToClipboard(o){var e=document.createElement('textarea');e.value=o,e.style.top='0',e.style.left='0',e.style.position='fixed',document.body.appendChild(e),e.focus(),e.select();try{document.execCommand('copy')}catch(o){console.error('Fallback: Oops, unable to copy',o)}document.body.removeChild(e)}event.preventDefault();let copyTextToClipboard=o=>{navigator.clipboard?navigator.clipboard.writeText(o).then(function(){},function(o){console.error('Async: Could not copy text: ',o)}):fallbackCopyTextToClipboard(o)};copyTextToClipboard('${this.connectionId}');">${this.connectionId}</a>
                  `,
            buttons: ["ok:good"],
        });
        this.ingameState.core.root.hud.parts.dialogs.internalShowDialog(dialog);
    }

    setupClient(peer) {
        //Peer aleady connected, only add events
        this.onOpen(peer)();
        peer.on("data", this.onMessage(peer));
        peer.on("close", () => {
            console.log(this.connectionId + " closed");
            this.ingameState.goBackToMenu();
        });
        peer.on("error", err => {
            console.error(err);
        });
    }

    createPeer(socket, socketId, data) {
        //Create peer
        const peer = new Peer({ initiator: true, wrtc: wrtc, config: config });
        const peerId = uuidv4();

        //Setup peer connection
        peer.on("signal", signalData => {
            socket.emit("signal", {
                peerId: peerId,
                signal: signalData,
                senderId: socketId,
                receiverId: data.receiverId,
            });
        });
        socket.on("signal", signalData => {
            if (socketId !== signalData.receiverId) return;
            if (peerId !== signalData.peerId) return;

            peer.signal(signalData.signal);
        });

        //Handle peer events
        peer.on("connect", this.onOpen(peer));
        peer.on("data", this.onMessage(peer, peerId));
        peer.on("close", () => {
            console.log(peerId + " closed");
            const connection = this.connections.find(x => x.peerId === peerId);
            if (!connection) return;
            if (connection.user && this.ingameState && this.ingameState.core && this.ingameState.core.root) {
                for (let i = 0; i < this.connections.length; i++) {
                    if (this.connections[i].peerId === peerId) continue;
                    MultiplayerPacket.sendPacket(
                        this.connections[i].peer,
                        new TextPacket(TextPacketTypes.USER_DISCONNECTED, JSON.stringify(connection.user)),
                        this.connections
                    );
                }
                this.ingameState.core.root.hud.parts.notifications.onNotification(
                    shapezAPI.translations.multiplayer.user.disconnected.replaceAll(
                        "<username>",
                        connection.user.username
                    ),
                    enumNotificationType.success
                );
                this.users.splice(this.users.indexOf(connection.user), 1);
            }
            this.connections.splice(this.connections.indexOf(connection), 1);
        });
        peer.on("error", err => {
            console.error(err);
        });

        this.connections.push({ peer: peer, peerId: peerId });
    }

    /**
     * Handels events and send packets
     * @param {Peer.Instance} peer
     * @returns
     */
    onOpen(peer) {
        return async event => {
            this.ingameState.core.root.signals.entityAdded.add(entity => {
                const multiplayerId = this.multiplayerPlace.findIndex(origin =>
                    origin.equals(entity.components.StaticMapEntity.origin)
                );
                if (multiplayerId > -1) return this.multiplayerPlace.splice(multiplayerId, 1);
                MultiplayerPacket.sendPacket(
                    peer,
                    new SignalPacket(SignalPacketSignals.entityAdded, [entity])
                );

                if (entity.components.ConstantSignal) {
                    const constantSignalComponent = entity.components.ConstantSignal;
                    const constantSignalChange = this.ingameState.core.root.signals.constantSignalChange;

                    let component = new Proxy(constantSignalComponent, {
                        set: (target, key, value) => {
                            target[key] = value;
                            constantSignalChange.dispatch(entity, target);
                            return true;
                        },
                    });
                    entity.components.ConstantSignal = component;
                }
            });

            this.ingameState.core.root.signals.entityDestroyed.add(entity => {
                const multiplayerId = this.multiplayerDestroy.findIndex(origin =>
                    origin.equals(entity.components.StaticMapEntity.origin)
                );
                if (multiplayerId > -1) return this.multiplayerDestroy.splice(multiplayerId, 1);

                MultiplayerPacket.sendPacket(
                    peer,
                    new SignalPacket(SignalPacketSignals.entityDestroyed, [entity])
                );
            });
            //TODO: only constantSignal for now
            this.ingameState.core.root.signals.constantSignalChange.add((entity, constantSignalComponent) => {
                const multiplayerId = this.multiplayerConstantSignalChange.findIndex(origin =>
                    origin.equals(entity.components.StaticMapEntity.origin)
                );
                if (multiplayerId > -1) return this.multiplayerConstantSignalChange.splice(multiplayerId, 1);
                MultiplayerPacket.sendPacket(
                    peer,
                    new SignalPacket(SignalPacketSignals.entityComponentChanged, [
                        entity,
                        constantSignalComponent,
                    ])
                );
            });
            this.ingameState.core.root.signals.entityGotNewComponent.add(entity => {
                const multiplayerId = this.multipalyerComponentAdd.findIndex(origin =>
                    origin.equals(entity.components.StaticMapEntity.origin)
                );
                if (multiplayerId > -1) return this.multipalyerComponentAdd.splice(multiplayerId, 1);

                MultiplayerPacket.sendPacket(
                    peer,
                    new SignalPacket(SignalPacketSignals.entityComponentRemoved, [entity])
                );
            });
            this.ingameState.core.root.signals.entityComponentRemoved.add(entity => {
                const multiplayerId = this.multipalyerComponentRemove.findIndex(origin =>
                    origin.equals(entity.components.StaticMapEntity.origin)
                );
                if (multiplayerId > -1) return this.multipalyerComponentRemove.splice(multiplayerId, 1);

                MultiplayerPacket.sendPacket(
                    peer,
                    new SignalPacket(SignalPacketSignals.entityComponentRemoved, [entity])
                );
            });
            this.ingameState.core.root.signals.upgradePurchased.add(upgradeId => {
                if (this.multipalyerUnlockUpgrade.includes(upgradeId))
                    return this.multipalyerUnlockUpgrade.splice(
                        this.multipalyerUnlockUpgrade.indexOf(upgradeId),
                        1
                    );

                MultiplayerPacket.sendPacket(
                    peer,
                    new SignalPacket(SignalPacketSignals.upgradePurchased, [
                        new StringSerializable(upgradeId),
                    ])
                );
            });
            this.ingameState.core.root.hud.parts.buildingPlacer.signals.variantChanged.add(() => {
                const metaBuilding =
                    this.ingameState.core.root.hud.parts.buildingPlacer.currentMetaBuilding.get();
                if (!metaBuilding) this.user.currentMetaBuilding = undefined;
                else this.user.currentMetaBuilding = metaBuilding.getId();
                this.user.currentVariant =
                    this.ingameState.core.root.hud.parts.buildingPlacer.currentVariant.get();
                this.user.currentBaseRotation =
                    this.ingameState.core.root.hud.parts.buildingPlacer.currentBaseRotation;
                const mousePosition = this.ingameState.core.root.app.mousePosition;
                if (!mousePosition) this.user.mouseTile = undefined;
                else {
                    this.user.worldPos = this.ingameState.core.root.camera.screenToWorld(mousePosition);
                    this.user.mouseTile = this.user.worldPos.toTileSpace();
                }
                MultiplayerPacket.sendPacket(
                    peer,
                    new TextPacket(TextPacketTypes.USER_UPDATE, JSON.stringify(this.user))
                );
            });

            if (this.host) {
                await this.ingameState.doSave();
                console.log(this.ingameState.savegame.getCurrentDump());
                var dataPackets = DataPacket.createFromData(
                    {
                        mods: shapezAPI.modOrder,
                        version: this.ingameState.savegame.getCurrentVersion(),
                        dump: this.ingameState.savegame.getCurrentDump(),
                        stats: this.ingameState.savegame.getStatistics(),
                        lastUpdate: this.ingameState.savegame.getRealLastUpdate(),
                    },
                    600
                );

                MultiplayerPacket.sendPacket(peer, new FlagPacket(FlagPacketFlags.STARTDATA));
                for (let i = 0; i < dataPackets.length; i++) {
                    MultiplayerPacket.sendPacket(peer, dataPackets[i]);
                }
                MultiplayerPacket.sendPacket(peer, new FlagPacket(FlagPacketFlags.ENDDATA));
            } else
                MultiplayerPacket.sendPacket(
                    peer,
                    new TextPacket(TextPacketTypes.USER_JOINED, JSON.stringify(this.user))
                );
        };
    }

    //Handels incomming packets
    onMessage(peer, peerId = null) {
        return data => {
            var packet = JSON.parse(data);
            if (
                packet.type === MultiplayerPacketTypes.FLAG &&
                packet.flag === FlagPacketFlags.RECEIVED_PACKET
            ) {
                MultiplayerPacket.sendNextPacket();
            } else {
                MultiplayerPacket.sendPacket(peer, new FlagPacket(FlagPacketFlags.RECEIVED_PACKET));
            }
            if (packet.type === MultiplayerPacketTypes.SIGNAL) {
                packet.args = MultiplayerPacket.deserialize(packet.args, this.ingameState.core.root);

                if (this.host) {
                    for (let i = 0; i < this.connections.length; i++) {
                        // if (this.connections[i].peerId === peerId) continue;
                        // if (packet.signal === SignalPacketSignals.entityAdded && getBuildingDataFromCode(packet.args[0].components.StaticMapEntity.code).metaClass === shapezAPI.ingame.buildings.belt) continue;
                        // if (packet.signal === SignalPacketSignals.entityAdded && getBuildingDataFromCode(packet.args[0].components.StaticMapEntity.code).metaClass === shapezAPI.ingame.buildings.wire) continue;
                        MultiplayerPacket.sendPacket(
                            this.connections[i].peer,
                            new SignalPacket(packet.signal, packet.args),
                            this.connections
                        );
                    }
                }

                if (packet.signal === SignalPacketSignals.entityAdded) {
                    var entity = packet.args[0];

                    this.multiplayerPlace.push(entity.components.StaticMapEntity.origin);
                    this.builder.tryPlaceCurrentBuildingAt(
                        entity.components.StaticMapEntity.origin,
                        {
                            origin: entity.components.StaticMapEntity.origin,
                            originalRotation: entity.components.StaticMapEntity.originalRotation,
                            rotation: entity.components.StaticMapEntity.rotation,
                            rotationVariant: getBuildingDataFromCode(entity.components.StaticMapEntity.code)
                                .rotationVariant,
                            variant: getBuildingDataFromCode(entity.components.StaticMapEntity.code).variant,
                            building: getBuildingDataFromCode(entity.components.StaticMapEntity.code)
                                .metaInstance,
                        },
                        entity.uid
                    );
                }
                if (packet.signal === SignalPacketSignals.entityDestroyed) {
                    let entity = this.builder.findByOrigin(
                        this.ingameState.core.root.entityMgr,
                        packet.args[0].components.StaticMapEntity.origin
                    );
                    if (entity !== null) {
                        this.multiplayerDestroy.push(entity.components.StaticMapEntity.origin);
                        this.ingameState.core.root.logic.tryDeleteBuilding(entity);
                    }
                }
                if (packet.signal === SignalPacketSignals.entityComponentChanged) {
                    let entity = this.builder.findByOrigin(
                        this.ingameState.core.root.entityMgr,
                        packet.args[0].components.StaticMapEntity.origin
                    );
                    let component = packet.args[1];
                    if (entity === null) return;
                    this.multiplayerConstantSignalChange.push(entity.components.StaticMapEntity.origin);
                    for (const key in component) {
                        if (!component.hasOwnProperty(key)) continue;
                        entity.components[component.constructor.getId()][key] = component[key];
                    }
                }
                if (packet.signal === SignalPacketSignals.upgradePurchased) {
                    this.multipalyerUnlockUpgrade.push(packet.args[0].value);
                    this.ingameState.core.root.hubGoals.tryUnlockUpgrade(packet.args[0].value);
                }
            } else if (packet.type === MultiplayerPacketTypes.TEXT) {
                if (packet.textType === TextPacketTypes.USER_JOINED) {
                    let user = JSON.parse(packet.text);

                    //Send to other clients
                    if (this.host) {
                        for (let i = 0; i < this.connections.length; i++) {
                            if (this.connections[i].peerId === peerId) continue;
                            MultiplayerPacket.sendPacket(
                                this.connections[i].peer,
                                new TextPacket(TextPacketTypes.USER_JOINED, packet.text),
                                this.connections
                            );
                        }

                        MultiplayerPacket.sendPacket(
                            this.connections.find(x => x.peerId === peerId).peer,
                            new TextPacket(TextPacketTypes.HOST_USER, JSON.stringify(this.user)),
                            this.connections
                        );
                    }

                    //Add user
                    this.users.push(user);
                    if (this.host) this.connections.find(x => x.peerId === peerId).user = user;
                    this.ingameState.core.root.hud.parts.notifications.onNotification(
                        shapezAPI.translations.multiplayer.user.joined.replaceAll(
                            "<username>",
                            user.username
                        ),
                        enumNotificationType.success
                    );
                } else if (packet.textType === TextPacketTypes.USER_DISCONNECTED) {
                    let user = JSON.parse(packet.text);
                    this.ingameState.core.root.hud.parts.notifications.onNotification(
                        shapezAPI.translations.multiplayer.user.disconnected.replaceAll(
                            "<username>",
                            user.username
                        ),
                        enumNotificationType.success
                    );
                    this.users.splice(this.users.indexOf(user), 1);
                } else if (packet.textType === TextPacketTypes.HOST_USER) {
                    let user = JSON.parse(packet.text);

                    //Add user
                    this.users.push(user);
                } else if (packet.textType === TextPacketTypes.USER_UPDATE) {
                    let user = JSON.parse(packet.text);

                    //Send to other clients
                    if (this.host) {
                        for (let i = 0; i < this.connections.length; i++) {
                            if (this.connections[i].peerId === peerId) continue;
                            MultiplayerPacket.sendPacket(
                                this.connections[i].peer,
                                new TextPacket(TextPacketTypes.USER_UPDATE, packet.text),
                                this.connections
                            );
                        }
                    }

                    //Update user
                    let index = this.users.findIndex(x => x._id === user._id);
                    if (index >= 0) this.users[index] = user;
                    else this.users.push(user);

                    if (this.host) this.connections.find(x => x.peerId === peerId).user = user;
                } else if (packet.textType === TextPacketTypes.MESSAGE) {
                    // let user = this.connections.find((x) => x.peerId === peerId).user;
                    this.ingameState.core.root.hud.parts.notifications.onNotification(
                        packet.text,
                        enumNotificationType.message
                    );
                }
            }
        };
    }
}
