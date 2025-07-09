// Discord Speed Modeling Bot
const { Client, GatewayIntentBits, Partials, EmbedBuilder, AttachmentBuilder } = require('discord.js');
const fs = require('fs');
const path = require('path');

// Initialize client with necessary intents
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers,
  ],
  partials: [Partials.Channel],
});

// Bot configuration
const prefix = '!';
const competitions = new Map();

// Bot token from environment variable
const token = process.env.DISCORD_BOT_TOKEN;

// Competition class to manage state
class ModelingCompetition {
  constructor(channelId) {
    this.channelId = channelId;
    this.topic = null;
    this.timeLimit = null; // in minutes
    this.startTime = null;
    this.endTime = null;
    this.participants = new Set();
    this.submissions = new Map(); // userId -> submission
    this.timer = null;
    this.isActive = false;
  }

  setTopic(topic) {
    this.topic = topic;
    return `Topic set to: **${topic}**`;
  }

  setTimeLimit(minutes) {
    if (isNaN(minutes) || minutes <= 0) {
      return "Please provide a valid time limit in minutes.";
    }
    this.timeLimit = minutes;
    return `Time limit set to: **${minutes} minutes**`;
  }

  getTimeLeft() {
    if (!this.isActive) {
      return "No active competition running.";
    }
    
    const now = Date.now();
    const timeLeft = this.endTime - now;
    
    if (timeLeft <= 0) {
      return "Time's up!";
    }
    
    const minutesLeft = Math.floor(timeLeft / 60000);
    const secondsLeft = Math.floor((timeLeft % 60000) / 1000);
    
    return `Time remaining: **${minutesLeft}m ${secondsLeft}s**`;
  }

  addParticipant(userId, username) {
    if (!this.isActive) {
      return "There's no active competition to join.";
    }
    
    this.participants.add({ id: userId, name: username });
    return `${username} has joined the competition!`;
  }

  removeParticipant(userId, username) {
    if (!this.isActive) {
      return "There's no active competition to leave.";
    }
    
    const removed = [...this.participants].some(p => p.id === userId);
    if (removed) {
      this.participants = new Set([...this.participants].filter(p => p.id !== userId));
      return `${username} has left the competition.`;
    }
    
    return `${username} is not in the competition.`;
  }

  submitEntry(userId, username, imageUrl) {
    if (!this.isActive) {
      return "There's no active competition to submit to.";
    }
    
    const isParticipant = [...this.participants].some(p => p.id === userId);
    if (!isParticipant) {
      return "You need to join the competition first with !in";
    }
    
    this.submissions.set(userId, {
      username,
      imageUrl,
      timestamp: Date.now()
    });
    
    return `${username}'s submission has been recorded!`;
  }

  start(channel) {
    if (!this.topic) {
      return "Please set a topic first using !topic";
    }
    
    if (!this.timeLimit) {
      return "Please set a time limit first using !limit";
    }
    
    this.startTime = Date.now();
    this.endTime = this.startTime + (this.timeLimit * 60000);
    this.isActive = true;
    
    // Set timeout to end the competition
    this.timer = setTimeout(() => {
      this.end(channel);
    }, this.timeLimit * 60000);
    
    return {
      title: "Speed Modeling Competition Started!",
      description: `
**Topic:** ${this.topic}
**Time Limit:** ${this.timeLimit} minutes
**End Time:** <t:${Math.floor(this.endTime / 1000)}:R>

Join with \`!in\` and submit your result with \`!upload\` (attach your image)
      `
    };
  }

  async end(channel) {
    if (!this.isActive) {
      return "No active competition to end.";
    }
    
    this.isActive = false;
    clearTimeout(this.timer);
    
    // Send ending message
    await channel.send({
      embeds: [
        new EmbedBuilder()
          .setTitle("Competition Ended!")
          .setDescription(`The modeling competition for topic "${this.topic}" has ended!`)
          .setColor(0xFF5555)
      ]
    });
    
    // Post results to history channel
    await this.postResults(channel);
    
    // Reset competition
    this.reset();
    
    return "Competition ended and results posted to the gallery.";
  }

  async postResults(channel) {
    try {
      // Find the history/gallery channel
      const guild = channel.guild;
      const galleryChannel = guild.channels.cache.find(c => 
        c.name.toLowerCase().includes('history') || 
        c.name.toLowerCase().includes('gallery')
      );
      
      if (!galleryChannel) {
        await channel.send("Could not find a history or gallery channel. Please create one!");
        return;
      }
      
      // Create the gallery post
      const resultsEmbed = new EmbedBuilder()
        .setTitle(`Model Competition Results: ${this.topic}`)
        .setDescription(`
          **Topic:** ${this.topic}
          **Time Limit:** ${this.timeLimit} minutes
          **Participants:** ${this.participants.size}
          **Submissions:** ${this.submissions.size}
        `)
        .setColor(0x55AAFF)
        .setTimestamp();
      
      await galleryChannel.send({ embeds: [resultsEmbed] });
      
      // Post all submissions
      for (const [userId, submission] of this.submissions.entries()) {
        const submissionEmbed = new EmbedBuilder()
          .setTitle(`${submission.username}'s Submission`)
          .setImage(submission.imageUrl)
          .setColor(0x55FF55)
          .setTimestamp(submission.timestamp);
        
        await galleryChannel.send({ embeds: [submissionEmbed] });
      }
      
      await channel.send(`Results posted in <#${galleryChannel.id}>!`);
    } catch (error) {
      console.error("Error posting results:", error);
      await channel.send("There was an error posting results to the gallery.");
    }
  }

  reset() {
    this.topic = null;
    this.timeLimit = null;
    this.startTime = null;
    this.endTime = null;
    this.participants = new Set();
    this.submissions = new Map();
    this.timer = null;
    this.isActive = false;
  }

  getStatus() {
    if (!this.isActive) {
      return {
        title: "No Active Competition",
        description: "Use `!topic` to set a topic and `!limit` to set a time limit, then use these commands to start a competition."
      };
    }
    
    return {
      title: "Active Model Competition",
      description: `
**Topic:** ${this.topic}
**Time Limit:** ${this.timeLimit} minutes
**Time Left:** ${this.getTimeLeft()}
**Participants:** ${this.participants.size}
**Submissions:** ${this.submissions.size}
      `
    };
  }
}

// When bot is ready
client.once('ready', () => {
  console.log(`Logged in as ${client.user.tag}`);
  client.user.setActivity('!help for commands', { type: 'PLAYING' });
});

// Message handler
client.on('messageCreate', async (message) => {
  // Ignore bot messages
  if (message.author.bot) return;
  
  // Check for prefix
  if (!message.content.startsWith(prefix)) return;
  
  // Parse command and arguments
  const args = message.content.slice(prefix.length).trim().split(/ +/);
  const command = args.shift().toLowerCase();
  
  // Get or create competition for this channel
  let competition = competitions.get(message.channel.id);
  if (!competition) {
    competition = new ModelingCompetition(message.channel.id);
    competitions.set(message.channel.id, competition);
  }
  
  // Command handler
  switch (command) {
    case 'help':
      const helpEmbed = new EmbedBuilder()
        .setTitle('Speed Model Bot Commands')
        .setDescription(`
          **!topic [text]** - Set the topic
          **!limit [minutes]** - Set the time limit
          **!timeleft** - Check remaining time
          **!in** - Join the competition
          **!out** - Leave the competition
          **!upload** - Submit your result (attach an image)
          **!start** - Start the competition
          **!status** - Check competition status
          **!end** - End the competition (admin only)
        `)
        .setColor(0x5599FF);
      
      await message.channel.send({ embeds: [helpEmbed] });
      break;
      
    case 'topic':
      const topic = args.join(' ');
      if (!topic) {
        await message.reply("Please provide a topic. Example: `!topic Space cats`");
        break;
      }
      const topicResponse = competition.setTopic(topic);
      await message.channel.send(topicResponse);
      break;
      
    case 'limit':
      const minutes = parseInt(args[0]);
      const limitResponse = competition.setTimeLimit(minutes);
      await message.channel.send(limitResponse);
      break;
      
    case 'timeleft':
      const timeLeftResponse = competition.getTimeLeft();
      await message.channel.send(timeLeftResponse);
      break;
      
    case 'in':
      const joinResponse = competition.addParticipant(message.author.id, message.author.username);
      await message.channel.send(joinResponse);
      break;
      
    case 'out':
      const leaveResponse = competition.removeParticipant(message.author.id, message.author.username);
      await message.channel.send(leaveResponse);
      break;
      
    case 'upload':
      // Check if there's an attachment
      if (message.attachments.size === 0) {
        await message.reply("Please attach an image with your submission.");
        break;
      }
      
      const attachment = message.attachments.first();
      const imageUrl = attachment.url;
      const submitResponse = competition.submitEntry(message.author.id, message.author.username, imageUrl);
      await message.channel.send(submitResponse);
      break;
      
    case 'start':
      const startResponse = competition.start(message.channel);
      if (typeof startResponse === 'string') {
        await message.channel.send(startResponse);
      } else {
        const startEmbed = new EmbedBuilder()
          .setTitle(startResponse.title)
          .setDescription(startResponse.description)
          .setColor(0x55FF55);
        
        await message.channel.send({ embeds: [startEmbed] });
      }
      break;
      
    case 'status':
      const status = competition.getStatus();
      const statusEmbed = new EmbedBuilder()
        .setTitle(status.title)
        .setDescription(status.description)
        .setColor(0x5555FF);
      
      await message.channel.send({ embeds: [statusEmbed] });
      break;
      
    case 'end':
      // Check if user has permission to end
      if (!message.member.permissions.has('MANAGE_CHANNELS')) {
        await message.reply("You don't have permission to end the competition.");
        break;
      }
      
      const endResponse = await competition.end(message.channel);
      await message.channel.send(endResponse);
      break;
  }
});

// Login to Discord
client.login(token);