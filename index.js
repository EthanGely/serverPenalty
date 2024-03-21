import express from 'express';
import { createServer } from 'node:http';
import cors from 'cors';
import { Server } from 'socket.io';
import { log } from 'node:console';
import { SocketAddress } from 'node:net';
import { serialize } from 'node:v8';
import e from 'express';

const app = express();
const server = createServer(app);
const io = new Server(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

let players = [];

const maxRounds = 4;
const maxShoots = 5;
let rounds = 1;
let shoots = 0;

let pointsManche = [];

app.use(cors());

app.get('/', (req, res) => {
    res.send("It works!");
});

io.on('connection', (socket) => {
    socket.emit("location", "/");

    socket.on('disconnect', () => {
        // Find the index of the player with the socketId
        const playerIndex = players.findIndex(player => player.socketId === socket.id);

        // If the player exists, remove it from the players array
        if (playerIndex !== -1) {
            players.splice(playerIndex, 1);
        }

        console.log('Player number: ', players.length);
    });

    socket.on("gamePad", (gamepadsPlayer, ipAddr) => {
        if (gamepadsPlayer >= 0 && ipAddr) {
            const player = players.find(player => player.socketId == socket.id);

            // Check if the player exists
            if (player) {
                // If the player has no ip address, save it
                if (player.ipAddr === null) {
                    player.ipAddr = ipAddr;
                }

                // A Player who has the same ip and same controller, but different socket (local)
                const playerController = players.find(player => player.gamepadId === gamepadsPlayer && player.ipAddr === ipAddr && player.socketId !== socket.id);

                // if such a player does not exist, and the current player has no gamepad, save it.
                if (!playerController && player.gamepadId === null) {
                    player.gamepadId = gamepadsPlayer;
                    socket.emit("gamePadID", player.gamepadId);
                    return;
                }
                if (player.gamepadId === null) {
                    socket.emit("gamePadID", -1);
                    return;
                } else {
                    socket.emit("gamePadID", player.gamepadId);
                    return;
                }
            }
        }
    });

    socket.on('playerName', (playerName) => {
        // Check if player already exists
        const existingPlayer = players.find(player => player.socketId == socket.id);

        if (!existingPlayer) {
            // If player does not exist, save its socket.id and given name
            players = [...players, { socketId: socket.id, name: playerName, score: 0, shoot: -1, points: 0, ipAddr: null, gamepadId: null }];
            pointsManche[socket.id] = Array(maxRounds).fill().map(() => Array(maxShoots).fill(null));
            socket.emit('waiting', true);
        }

        if (players.length == 2) {
            io.emit('startGame', true);

            let roles = ['goalkeeper', 'striker'];
            roles = roles.sort(() => Math.random() - 0.5);

            players.forEach((player, index) => {
                player.role = roles[index];
                io.to(player.socketId).emit('role', roles[index]);
                console.log(player.socketId, "is", roles[index])
            });
        }
    });

    socket.on("getInfos", () => {
        const player = players.find(player => player.socketId == socket.id);
        if (player) {
            let role = player.role == "goalkeeper" ? true : false;
            const otherPlayer = players.find(p => p !== player);
            socket.emit("infos", role, maxShoots, maxRounds, player.name + ' - ' + otherPlayer.name, null);
        }

    })

    // When a player shoots
    socket.on("shoot", (index) => {
        // we get the shooter and the goalkeeper
        const goalkeeper = players.find(player => player.role === 'goalkeeper');
        const striker = players.find(player => player.role === 'striker');

        // if there are still rounds left
        if (rounds <= maxRounds && shoots < maxShoots) {

            // we find the current player
            const currentPlayer = players.find(player => player.socketId == socket.id);

            // If the player exists and has yet to shoot / defned
            if (currentPlayer && currentPlayer.shoot === -1) {
                // Note his shoot / defense index
                currentPlayer.shoot = index;

                socket.emit("posShoot", index);

                // if the current player is the goalKeeper
                if (currentPlayer.role == "goalkeeper") {
                    // Move the goalKeeper to the correct position
                    socket.emit("posGoalkeeper", index);
                }

                // Check if all players shooted / defended
                const allPlayersShot = players.every(player => player.shoot !== -1);
                if (allPlayersShot) {

                    // Check who wins and add a point
                    if (goalkeeper.shoot === striker.shoot) {
                        pointsManche[goalkeeper.socketId][rounds - 1][shoots] = true;
                        pointsManche[striker.socketId][rounds - 1][shoots] = false;
                        goalkeeper.score++;
                    } else {
                        pointsManche[striker.socketId][rounds - 1][shoots] = true;
                        pointsManche[goalkeeper.socketId][rounds - 1][shoots] = false;
                        striker.score++;
                    }

                    // Then add a shoot
                    shoots++;

                    // Then, reset positions after 2 seconds
                    setTimeout(() => {
                        io.emit("newShoot");
                    }, 2000);

                    // If it is the last shoot of the round
                    if (shoots == maxShoots) {
                        // Reinit shoots to 0
                        shoots = 0;
                        // And add a round
                        rounds++;

                        // Check who wins the previous round and add points accordingly
                        if (goalkeeper.score > striker.score) {
                            goalkeeper.points += 2;
                        } else if (striker.score > goalkeeper.score) {
                            striker.points += 1;
                        }

                        // Reinit scores for next round
                        goalkeeper.score = 0;
                        striker.score = 0;

                        // Swith roles
                        players.forEach((player) => {
                            let role;
                            if (player.role == "goalkeeper") {
                                player.role = "striker";
                                role = false;
                            } else {
                                player.role = "goalkeeper";
                                role = true;
                            }

                            io.to(player.socketId).emit('infos', role, null, null, null, pointsManche[player.socketId][rounds]);
                        });
                    }

                    // Update game infos

                    players.forEach((player) => {

                        // Other player
                        const otherPlayer = players.find(p => p !== player);

                        let totalPoints = player.points + " - " + otherPlayer.points;

                        // Update score of the current round
                        io.to(player.socketId).emit('scoreUpdate', pointsManche[player.socketId][rounds - 1]);
                        // Update shoot number, and round number
                        io.to(player.socketId).emit('shootUpdate', rounds, totalPoints, striker.shoot, goalkeeper.shoot);
                    });

                    if (rounds > maxRounds) {
                        // Calculate points for each player
                        let playerPoints = players.map(player => {
                            return {
                                socketId: player.socketId,
                                points: player.points
                            };
                        });

                        // Sort players by points
                        playerPoints.sort((a, b) => b.points - a.points);

                        // Send "winner" or "loser" to each player
                        players.forEach(player => {
                            if (player.socketId === playerPoints[0].socketId) {
                                io.to(player.socketId).emit('endGame', true);
                            } else {
                                io.to(player.socketId).emit('endGame', false);
                            }
                        });

                        players = [];
                        rounds = 1;
                        shoots = 0;
                        pointsManche = [];
                        return;
                    }


                    // Reinit shoot / defense position
                    players.forEach(player => player.shoot = -1);
                } else {
                    // If one player has yet to shoot / defend
                    //console.log("waiting for other player");
                }
            } else {
                // If the player does not exists or has already shooted
                //console.log("Player does not exists or already shooted.")
            }
        } else {
            // End of the game
            //console.log("max number of rounds, end of game");

            // Calculate points for each player
            let playerPoints = players.map(player => {
                return {
                    socketId: player.socketId,
                    points: player.points
                };
            });

            // Sort players by points
            playerPoints.sort((a, b) => b.points - a.points);

            // Send "winner" or "loser" to each player
            players.forEach(player => {
                if (player.socketId === playerPoints[0].socketId) {
                    io.to(player.socketId).emit('endGame', true);
                } else {
                    io.to(player.socketId).emit('endGame', false);
                }
            });
        }
    })
});

server.listen(3000, () => {
    console.log('server running at http://localhost:3000');
});
