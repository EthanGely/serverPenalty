import express from 'express';
import { createServer } from 'node:http';
import cors from 'cors';
import { Server } from 'socket.io';
import { log } from 'node:console';
import { SocketAddress } from 'node:net';

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

app.use(cors());

app.get('/', (req, res) => {
    res.send("It works!");
});

io.on('connection', (socket) => {
    socket.emit("location", "/");

    socket.on('disconnect', () => {
        //Ne fonctionne pas sur Render :(
        //players = players.toSpliced(socket.id, 1);
        players = players.splice(socket.id, 1);
        console.log('Player number: ', players.length);
    });

    socket.on('playerName', (playerName) => {
        // Check if player already exists
        const existingPlayer = players.find(player => player.sockerId == socket.id);

        if (!existingPlayer) {
            // If player does not exist, save its socket.id and given name
            players = [...players, { socketId : socket.id, name: playerName, score: 0, shoot: -1, points: 0 }];
            console.log('Player number: ', players.length);
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

        console.log('players: ', players);
    });

    socket.on("getRole", () => {
        const existingPlayer = players.find(player => player.socketId == socket.id);
        if (existingPlayer) {
            socket.emit("role", existingPlayer.role);
            players.forEach((player) => {
                const otherPlayer = players.find(p => p !== player);
                io.to(player.socketId).emit('scoreUpdate', player.name + " (You) : " + player.score + " - " + otherPlayer.score + " : "+ otherPlayer.name);
                io.to(player.socketId).emit('shootUpdate', shoots, maxShoots, rounds, maxRounds, null, null);
            });
        }
        
    })

    // When a player shoots
    socket.on("shoot", (index) => {
        // we get the shooter and the goalkeeper
        const goalkeeper = players.find(player => player.role === 'goalkeeper');
        const striker = players.find(player => player.role === 'striker');

        // if there are still rounds left
        if (rounds <= maxRounds) {

            // we find the current player
            const currentPlayer = players.find(player => player.socketId == socket.id);

            // If the player exists and has yet to shoot / defned
            if (currentPlayer && currentPlayer.shoot === -1) {
                // Note his shoot / defense index
                currentPlayer.shoot = index;

                socket.emit("posShoot", index);

                // if the current player is the goalKeeper
                if(currentPlayer.role == "goalkeeper") {
                    // Move the goalKeeper to the correct position
                    socket.emit("posGoalkeeper", index);
                }

                // Check if all players shooted / defended
                const allPlayersShot = players.every(player => player.shoot !== -1);
                if (allPlayersShot) {
                    // If so, add a shot
                    shoots++;

                    // Check who wins and add a point
                    if (goalkeeper.shoot === striker.shoot) {
                        goalkeeper.score += 1;
                    } else {
                        striker.score += 1;
                    }

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
                        if (goalkeeper.score >= striker.score) {
                            goalkeeper.points += 2;
                        } if (striker.score >= goalkeeper.score) {
                            striker.points += 1;
                        }

                        // Reinit scores for next round
                        goalkeeper.score = 0;
                        striker.score = 0;
        
                        // Swith roles
                        players.forEach((player) => {
                            if (player.role == "goalkeeper") {
                                player.role = "striker";
                            } else {
                                player.role = "goalkeeper";
                            }
        
                            io.to(player.socketId).emit('role', player.role);
                        });
                    }

                    // Update game
                    players.forEach((player) => {
                        // Other player
                        const otherPlayer = players.find(p => p !== player);
                        // Update score of the current round
                        io.to(player.socketId).emit('scoreUpdate', player.name + "(You) : " + player.score + " - " + otherPlayer.score + " : "+ otherPlayer.name);
                        // Update shoot number, and round number
                        io.to(player.socketId).emit('shootUpdate', shoots, maxShoots, rounds, maxRounds, striker.shoot, goalkeeper.shoot);
                    });
                    
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
        }
    })
});

server.listen(3000, () => {
    console.log('server running at http://localhost:3000');
});