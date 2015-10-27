var Discord = require("../");
var Member = require("../lib/Member.js");
var mybot = new Discord.Client({
	compress : true
});
var fs = require("fs");
var request = require("request").defaults({ encoding: null });

Discord.patchStrings();

var server, channel, message, sentMessage = false;

counter = 1;

mybot.on("message", function (message) {
	
	
	
});

mybot.on("ready", function () {
	console.log("im ready");
	
	var server = mybot.getServer("name", "crap weasels");
	
	var voiceChannel;
	
	for(var channel of server.channels){
		if(channel.type === "voice" && channel.name.toLowerCase() === "general"){
			voiceChannel = channel;
		}
	}
	
	mybot.joinVoiceChannel(voiceChannel).catch(error);

});

function dump(msg) {
	console.log("dump", msg);
}

function error(err) {
	console.log(err.stack);
}

mybot.login(process.env["ds_email"], process.env["ds_password"]).catch(error);