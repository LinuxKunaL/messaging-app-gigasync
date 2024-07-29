import { ChatModel, User } from "../../database/model.js";
import { uploadFile } from "../utils/fileOperations.js";

class singleChatSocket {
  constructor(socket, io) {
    /**
     * this code for @init
     * the @socket and @io in
     * the constructor
     */
    this.socket = socket;
    this.io = io;

    /** ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
     * @Init socket @events for handles @chatMessage
     */
    this.socket.on("selectContact", this.selectContact.bind(this));
    this.socket.on("sendMessage", this.sendMessage.bind(this));
    this.socket.on("deleteMessage", this.deleteMessage.bind(this));
    this.socket.on("register", this.register.bind(this));
    this.socket.on("disconnect", this.unRegister.bind(this));
    //━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

    /** ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
     * @Init socket @events for handles @VideoCall
     */
    this.socket.on("send-ice-candidate", this.sendIceCandidate.bind(this));
    this.socket.on("call-user", this.callUser.bind(this));
    this.socket.on("call-cancel", this.callCancel.bind(this));
    this.socket.on("call-answered", this.callAnswered.bind(this));
    this.socket.on("call-reject", this.callReject.bind(this));
    this.socket.on("call-end", this.callEnd.bind(this));
    this.socket.on("call-toggle-camera", this.callToggleCamera.bind(this));
    this.socket.on("call-toggle-mic", this.callToggleMic.bind(this));
    //━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  }

  /**━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   * @functions for handle @chatMessage
   */
  async selectContact(data) {
    const chats = await ChatModel.findOne(
      {
        chatWithin: { $all: [data.me, data.to] },
      },
      {
        messages: 1,
      }
    ).populate({
      path: "messages.sender messages.receiver messages.replyMessage.to",
      select: "fullName username avatarColor isAvatar",
      options: { strictPopulate: false },
    });

    this.io
      .to(data.socketId)
      .emit("initialMessage", !chats ? [] : chats.messages);
  }

  async sendMessage(data) {
    const { me, to, message, replyMessage } = data;
    const { file } = message;
    
    var fileData = {
      size: null,
      type: null,
      name: null,
    };

    const receiver = await User.findById(to);

    if (!receiver.allChats.includes(me)) {
      receiver.allChats.push(me);
      await receiver.save();
    }

    const sender = await User.findById(me);

    if (!sender.allChats.includes(to)) {
      sender.allChats.push(to);
      await sender.save();
    }

    const receiverSocketId = receiver ? receiver.socketId : null;

    const chat = await ChatModel.findOne({
      chatWithin: { $all: [me, to] },
    });

    if (file.type !== "text") {
      fileData = uploadFile(file.data, me, "user");
    }

    if (!chat) {
      const newMessage = await ChatModel.create({
        chatWithin: [me, to],
      });

      newMessage.messages.push({
        message: {
          file: {
            type: fileData.type ? file.type : "text",
            name: fileData.name,
            size: fileData.size,
          },
          text: message.text,
        },
        sender: me,
        receiver: to,
        replyMessage,
      });

      await newMessage.save();

      const populatedChat = await newMessage.populate({
        path: "messages.sender messages.receiver messages.replyMessage.to",
        select: "fullName username avatarColor isAvatar",
        options: { strictPopulate: false },
      });

      this.io
        .to(receiverSocketId)
        .emit("receiveMessage", populatedChat.messages[0]);
      this.io
        .to(this.socket.id)
        .emit("receiveMessage", populatedChat.messages[0]);
      this.io
        .to(receiverSocketId)
        .emit("NewMessageNotification", populatedChat.messages[0]);

      return null;
    }
console.log(fileData.type);
    chat.messages.push({
      message: {
        file: {
          type: fileData.type ? file.type : "text",
          name: fileData.name,
          size: fileData.size,
        },
        text: message.text,
      },
      sender: me,
      receiver: to,
      replyMessage,
    });

    await chat.save();

    const populatedChat = await chat.populate({
      path: "chatWithin messages.sender messages.receiver messages.replyMessage.to",
      select: "fullName username avatarColor isAvatar",
      options: { strictPopulate: false },
    });

    const newMessage =
      populatedChat.messages[populatedChat.messages.length - 1];

    this.io.to(receiverSocketId).emit("receiveMessage", newMessage);
    this.io.to(this.socket.id).emit("receiveMessage", newMessage);
    this.io.to(receiverSocketId).emit("NewMessageNotification", newMessage);
  }

  async deleteMessage(data) {
    const { sender, receiver, messageId } = data;

    const _receiver = await User.findById(receiver);
    const _receiverSocketId = _receiver ? _receiver.socketId : null;

    await ChatModel.findOneAndUpdate(
      {
        chatWithin: { $all: [sender, receiver] },
        "messages._id": messageId,
      },
      {
        $set: {
          "messages.$.message.text": "message deleted",
          "messages.$.message.file.type": "del",
          "messages.$.message.file.name": null,
          "messages.$.message.file.size": null,
        },
      },
      {
        new: true,
      }
    );

    this.selectContact({
      me: sender,
      to: receiver,
      socketId: data.socketId,
    });

    this.selectContact({
      me: receiver,
      to: sender,
      socketId: _receiverSocketId,
    });
  }

  async register(userId) {
    const data = {
      socketId: this.socket.id,
      lastSeen: Date.now(),
      status: "online",
    };

    await User.findByIdAndUpdate(userId, data);
    this.emitStatus();
  }

  async unRegister() {
    const data = {
      socketId: this.socket.id,
      lastSeen: Date.now(),
      status: "offline",
    };

    await User.findOneAndUpdate({ socketId: this.socket.id }, data);
    this.emitStatus();

    this.socket.off("sendMessage", this.sendMessage);
    this.socket.off("deleteMessage", this.deleteMessage);
    this.socket.off("selectContact", this.selectContact);
    this.socket.off("register", this.register);
  }

  async emitStatus() {
    const userForSocketId = await User.findOne({ socketId: this.socket.id });

    const chat = await ChatModel.findOne(
      {
        chatWithin: { $all: [userForSocketId?._id] },
      },
      {
        chatWithin: 1,
        _id: 0,
      }
    ).populate({
      path: "chatWithin",
      select: "socketId",
    });
    this.io.emit("status", chat?.chatWithin);
  }
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  /**━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   * @functions for handle @VideoCall
   */
  async sendIceCandidate(data) {
    const { to, candidate, from } = data;
    const { socketId } = await User.findById(to);
    this.io.to(socketId).emit("OnIncomingIceCandidate", { from, candidate });
  }

  async callUser(data) {
    const { from, to, signal, streamSetting } = data;

    const { socketId } = await User.findById(to);
    const user = await User.findById(from);

    this.io
      .to(socketId)
      .emit("OnIncomingCall", { signal, user, streamSetting });
  }

  async callAnswered(data) {
    const { signal, to, streamSetting } = data;
    const { socketId } = await User.findById(to);
    this.io.to(socketId).emit("OnCallAnswered", { signal, streamSetting });
  }

  async callCancel(data) {
    const { to } = data;
    const { socketId, fullName } = await User.findById(to);

    this.io.to(socketId).emit("OnCallCanceled", { fullName });
  }

  async callReject(data) {
    const { to } = data;
    const { socketId } = await User.findById(to);
    this.io.to(socketId).emit("OnCallRejected");
  }

  async callEnd(data) {
    const { to } = data;
    const { socketId } = await User.findById(to);
    this.io.to(socketId).emit("OnCallEnd");
  }

  async callToggleCamera(data) {
    const { to, isTrackEnabled } = data;
    const { socketId } = await User.findById(to);
    this.io.to(socketId).emit("OnToggleCamera", { isTrackEnabled });
  }

  async callToggleMic(data) {
    const { to, isTrackEnabled } = data;
    const { socketId } = await User.findById(to);
    console.log(isTrackEnabled);
    this.io.to(socketId).emit("OnToggleMic", { isTrackEnabled });
  }

  //━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
}

export default singleChatSocket;
