/* dependencies */
const http = require("http");
const fs = require("fs");                               // file system
const path = require("path");                           // access paths
const express = require("express");                     // express
const MongoClient = require('mongodb').MongoClient;     // talk to mongo
const bodyParser = require('body-parser');              // parse request body
var session = require('express-session')				// create sessions
var db;													// placeholder for our database

const app = express();
app.set("port", process.env.PORT || 3000)				// we're gonna start a server on whatever the environment port is or on 3000
app.set("views", path.join(__dirname, "views"));        // tells us where our views are
app.set("view engine", "ejs");                          // tells us what view engine to use

app.use(express.static(__dirname + '/'));               // sets the correct views for the CSS file/generally accessing files

const main = require("./app/main");
const dataops = require("./app/database");


/* Connecting to the DB */


MongoClient.connect("mongodb://localhost:27017/conquest", function(err, database){
	if (err){
		console.log("MAYDAY! MAYDAY! Crashing.");
		return console.log(err);
	}

	console.log("Got the database!");

	db = database;										// mongo passes us a database, we store its contents in this variable... I think.
	
	app.use(bodyParser.urlencoded({
	    extended: true
	}));

	app.use(bodyParser.json()); 						// for parsing application/json


	app.use(session({
		secret: 'awfulPassword',
	 	saveUninitialized: false,
	 	resave: false,
	 	secure: false,
	 	cookie: {}
	}));

	app.use(function(req, res, next){                  							// logs request URL
	    var timeNow = new Date();
	    console.log("Request: " + req.method.toUpperCase() + " " + req.url + " on " + timeNow);	
	    next();
	});

	app.use(function(req, res, next) {											// makes session available to all views
	 	app.locals.session = req.session;
	 	app.locals.error = req.session.error;									// making copies like this is clunky, but it works
	 	app.locals.message = req.session.message;
	 	req.session.error = null;
	 	req.session.message = null;
	 	next();
	})

	// every time a request comes in, we want to resolve all the actions.

	/* for example, let's say all attacks have to be blocked within 10 minutes.

	1. get all actions where date < (now - 10 mins)
	2. for each action, update the HP for relevant players <-- how will the player find out?
	3. delete the action object

	*/

	app.use(function(req, res, next){
		console.log("RESOLVING ATTACKS");
		
		var tenMinutesAgo = Date.now() - (1000*60*10); 				// we're in milliseconds by default
		var tenSecondsAgo = Date.now() - (1000*10);
		var oneHourAgo = Date.now() - (1000*60*60);


		var query = {
			/* CHANGE TO $LT AFTER TESTING */
			date: {$lt: oneHourAgo},				// this is a mongo query for greater than
			type: "attack"
		}

		dataops.find(db, "action", query, res, function resolveActions(allEligibleActions){		// this gets us all the actions that are more than 10 mins long
			if(allEligibleActions.length > 0){
				console.log("pulled " + allEligibleActions.length + " attacks to resolve.");
				allEligibleActions.forEach(function removeAttack(eligibleAttack){		// for every action...
					console.log("Starting to work on the attack: " + eligibleAttack.date);
					playerQuery = {									// ... find the player that action targets
						name: eligibleAttack.to
					}

					dataops.find(db, "player", playerQuery, res, function changeStats(attackedPlayer){			
						console.log("decreasing HP for " + attackedPlayer[0].name)
						// decrease HP by the weight of the attach

						var query = {
							"stats.hp": attackedPlayer[0].stats.hp - eligibleAttack.data.weight
						}

						dataops.update(db, "player", attackedPlayer[0], query, res, null, false, false, function removeAction(attack){	

							var actionToRemove = {
								date: eligibleAttack.date
							}

							dataops.remove(db, "action", actionToRemove, res, function confirmRemove(result){
								console.log("action with date " + actionToRemove.date + " removed!");
								next();
							})
						})
					});


				});

				// console.log("Resolved " + allEligibleActions.length + " attacks");
			} else {
				console.log("there are no attacks to resolve!");
				next();
			}

		});
	});


	app.get("/", function(req, res){
	    res.render("index");
	});



	// load a game
	
	app.get("/game", function(req, res){							/* !!! need to make sure a player BELONGS to a game before they're able to see this. */
		console.log("GETTING /GAME");
		if(req.session.user){													// only let the player see this page if they're the player
			dataops.find(db, "player", req.body, res, function(all_players){	// get all the players
				
				var query_to = {										// we're looking for all actions where the "to" attribute is the current player
					to: req.session.user.name
				}

				var query_from = {										// we're looking for all actions where the "to" attribute is the current player
					from: req.session.user.name
				}

				dataops.findAction(db, "action", { $or: [ query_from, query_to]}, res, function(all_actions){
				    var current_player = all_players.filter(function(el){			// filter the current player by ID stored in session
			    		return el._id == req.session.user._id;
			    	});
			    	res.render("game", {player: current_player, opponents: all_players, actions: all_actions});	
		    	});
			});
		} else {
			req.session.message = "You need to log in";
			res.redirect("/login");
		}
	});

	app.get("/newplayer", function(req, res){
		res.render("newplayer", {"session": req.session});
	});


	app.post("/newplayer", function(req, res){
		console.log(req.body);
		if((req.body.name).replace(/\s/g, '').length > 0 && (req.body.capital).replace(/\s/g, '').length > 0){			// let's make sure the input name isn't empty
				
				var new_player = {
					name: req.body.name,
					capital: req.body.capital,
					walls: "wood",
					stats: {
						hp: 100,
						strength: 10,
						walls: "wood",
					},
					units: {
						footmen: 10,
						ft_lvl: 1,
						archers: 5,
						ar_lvl: 1,
						scout: 1
					}
				}

				dataops.addNewPlayer(db, "player", new_player, res, function(result){
				req.session.message = result;
				res.redirect("/login");
			});
		} else {
			res.send("cannot save player with no name or capital");
		}
		
	});

	app.get("/login", function(req, res){
		res.render("login");
	});

	app.post("/login", function(req, res){
		console.log(req.body);
		if((req.body.name).replace(/\s/g, '').length >0){
			dataops.find(db, "player", {name: req.body.name}, res, function displayPlayer(result){
				if(result.length > 0){
					req.session.user = result[0];

					var day = 60000*60*24;

					req.session.expires = new Date(Date.now() + (30*day));			// this helps the session keep track of the expire date
					req.session.cookie.maxAge = (30*day);							// this is what makes the cookie expire
					console.log("Cookie set! ");
				//	console.log(req.session.cookie);
					res.redirect("/game");
				} else {
					req.session.user = null;
					res.render("login", {error: "incorrect login"});
				}
			});
		} else {
			res.render("login", {error: "blank username"});
		}
	
	});


	app.get("/time-to-logout", function(req, res){
/*		console.log("req.session.expires:");
		console.log(req.session.expires);*/
		res.send(req.session.expires);
	});

	app.get("/logout", function(req, res){
		req.session.user = null;
		req.session.expires = new Date(Date.now);		/* not sure if this is needed*/
		res.render("index", {error: "Logged out"});
	})


	app.get("/allplayers", function(req, res){
	    dataops.find(db, "player", req.body, res, function(result){
	    	res.render("allplayers", { "players": result, "session": req.session });
	    });
	});

	app.delete("/allplayers", function(req, res){
		dataops.deletePlayer(db, "player", req.body, res, function(result){
		res.send(result);
		});
	});




	/* game actions */


	app.post("/game", function(req, res){
		// console.log("req.body:");
		// console.log(req.body);

		if(req.body.action == "scout"){

			console.log("got the ajax call...");

			var pl = {
				"name": req.session.user.name
			}
			console.log("pl hp is: " + req.session.user.stats.hp);
			var q = { "stats.hp": (req.session.user.stats.hp + 10)};

			dataops.update(db, "player", pl, q, res, false, null, null, function updateScreen(result){
				console.log("Done updating");	
				req.session.user = result[0];
				res.send(req.session.user);
			});

			//res.end();
		}

		if(req.body.action == "build"){
			res.send("let me get the bricks.");
		}


		if(req.body.action == "attack"){
			console.log("back end: received attack");
			
			// pull the player's data:

			var dt = Date.now();
			var targetPlayer = {
				name: req.body.player
			}; 
			var action = {
				type: "attack",
				from: req.session.user.name,
				to: targetPlayer.name,
				date: dt,
				expires: (1000*60*60), 					// in MS
				data: {
					weight: req.session.user.stats.strength
				}
			};

			 dataops.add(db, "action", action, res, function(targetPlayer){
		    	res.send("Server: viciously attacked " + req.body.player);
		    });
			
		}

		if(req.body.action == "block"){
			console.log("back end: received block");

			var currentPlayer = {
				name: req.session.user.name
			}; 
			var query = {
				type: "attack", 
				to: req.session.user.name
			};

			/* 
				I need to figure out how to remove the most recent attack. Check out the $sort mongo function
			*/


			// search for all actions with the type attack against the current player:
			// sort in a descending order (oldest first)

			dataops.findAction(db, "action", query, res, function(actions_against_player){		
				console.log("Most recent attack:");
				console.log(actions_against_player[0]);
				if(typeof(actions_against_player)[0] != "undefined"){
					dataops.remove(db, "action", {date: actions_against_player[0].date}, res, function(result){			
						res.send({date: actions_against_player[0].date, message: "blocked action!"});
					});
				} else {
					res.send({message: "there's nothing to block!"});
				}
			});			
		}

		if(req.body.action == "block-2"){
			console.log("back end: received block");

			var currentPlayer = {
				name: req.session.user.name
			}; 
			var query = {
				date: parseInt(req.body.date)
			};

			/* 
				I need to figure out how to remove the most recent attack. Check out the $sort mongo function
			*/


			// search for all actions with the type attack against the current player:
			// sort in a descending order (oldest first)

			dataops.findAction(db, "action", query, res, function(actions_against_player){		
				console.log("Most recent attack:");
				console.log(actions_against_player[0]);
				if(typeof(actions_against_player)[0] != "undefined"){
					dataops.remove(db, "action", {date: actions_against_player[0].date}, res, function(result){			
						res.send({date: actions_against_player[0].date, message: "blocked action!"});
					});
				} else {
					res.send({message: "there's nothing to block!"});
				}
				

				
			});

	    }




    	if(req.body.action == "getUpdatedInfo"){
    		console.log("====================");
    		console.log("SERVER: getting updated health");
//    		if(req.session.user)}
    		query = {
    			name: req.session.user.name
    		}

    		dataops.find(db, "player", query, res, function(player){
    			console.log("Updated user health is: " + player[0].stats.hp)

    			var updatedHealth = {
    				hp: player[0].stats.hp
    			}
    			console.log("====================");
    			res.send(updatedHealth);
    		});	
    	}
	});





	/* 404 */

	app.use(function(req, res) {
	    res.status(404);
	    req.session.error = "404 - page not found!";
	    res.redirect("/");
	});

	app.listen(app.get("port"), function() {
	    console.log("Server started on port " + app.get("port"));
	});
});
