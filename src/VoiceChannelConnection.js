var WebSocket = require("ws");

class VoiceChannelConnection{
	
	constructor(voiceChannel){
		this.voiceChannel = voiceChannel;
		this.websocket = new WebSocket();
		
		this.server = voiceChannel.server;
		this.token;
		this.session;
		this.endpoint;
		
		this.initData = {
			op : 4,
			d : {
				guild_id : this.server.id,
				channel_id  : this.voiceChannel_id,
				self_mute : false,
				self_deaf : false
			}
		}
		
	}
	
	init(token, session, endpoint){
		
	}
	
}

module.exports = VoiceChannelConnection;