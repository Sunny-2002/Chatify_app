const User = require('../models/userModel');
const Chat = require('../models/chatModel');
const Group = require('../models/groupModel');
const Member = require('../models/memberModel');
const GroupChat = require('../models/groupChatModel');
const Token = require('../models/tokenModel');

const sendEmail = require('../utils/sendEmail');

const ObjectId = require('mongodb').ObjectId;
const bcrypt = require('bcrypt');
const crypto = require('crypto');
const cloudinary = require('../config/cloudinaryConfig');
let streamifier = require('streamifier');

const get_public_id = (imageUrl) => {
	let startIndex = imageUrl.lastIndexOf('/') + 1;
	let endIndex = imageUrl.lastIndexOf('.');

	return imageUrl.slice(startIndex, endIndex);
}

const registerLoad = async (req, res) => {
	try {
		res.render('register');
	} catch (error) {
		console.log(error);
	}
}

const register = async (req, res) => {
	try {

		const userData = await User.findOne({ email: req.body.email});

		if(userData) {

			res.render('register', { success: false, message: 'Email already exists !' })
		
		} else {

			const passwordHash = await bcrypt.hash(req.body.password, 10);

			const user = new User({
				username: req.body.name,
				email: req.body.email,
				password: passwordHash
			});

			await user.save();

			res.render('register', { success: true, message: 'Registered successfully ! Please login to enter !' })
		}

	} catch (error) {
		console.log(error);
	}
}

const loginLoad = (req, res) => {
	try {
		res.render('login');
	} catch (error) {
		console.log(error);
	}
}

const login = async (req, res) => {
	try {
		const email = req.body.email;
		const password = req.body.password;

		const userData = await User.findOne({ email: email });

		if (userData) {

			const passwordMatch = await bcrypt.compare(password, userData.password);

			if (passwordMatch) {
				req.session.user = userData;
				res.cookie('user', JSON.stringify(userData));
				res.redirect('/dashboard');
			} else {
				res.render('login', { message: 'Incorrect password !!' });
			}

		} else {
			res.render('login', { message: 'User not registered or wrong credentials !!' })
		}

	} catch (error) {
		console.log(error);
	}
}

const logout = async (req, res) => {
	try {

		res.clearCookie('user');
		req.session.destroy();
		res.redirect('/');

	} catch (error) {
		console.log(error);
	}
}

const dashboard = async (req, res) => {
	try {

		let searchUser = req.query.user || '';
		let queryObject = {};

		queryObject._id = { $nin: [req.session.user._id] };

		if (searchUser) {
			queryObject.username = { $regex: searchUser, $options: "i" }; 
		}

		const userList = await User.find(queryObject);

		res.render('dashboard', { user: req.session.user, userList: userList });

	} catch (error) {
		console.log(error);
	}
}

const saveChat = async (req, res) => {
	try {

		const chat = new Chat({
			sender_id: req.body.sender_id,
			receiver_id: req.body.receiver_id,
			message: req.body.message
		})

		const newChat = await chat.save();
		res.status(200).send({ success: true, message: 'Chat stored successfully !!', data: newChat });

	} catch (error) {
		console.log(error);
		res.status(400).send({ success: false, message: error.message })
	}
}

const deleteChat = async (req, res) => {
	try {

		await Chat.deleteOne({ _id: req.body.chat_id });

		res.status(200).send({ success: true, message: 'Chat deleted successfully !!' });

	} catch (error) {
		console.log(error);
		res.status(400).send({ success: false, message: error.message })
	}
}

const updateChat = async (req, res) => {
	try {

		await Chat.findByIdAndUpdate({ _id: req.body.chat_id }, {
			$set: {
				message: req.body.message
			}
		});

		res.status(200).send({ success: true, message: 'Message updated successfully !!' });

	} catch (error) {
		console.log(error);
		res.status(400).send({ success: false, message: error.message })
	}
}

const loadGroups = async (req, res) => {
	try {

		const myGroups = await Group.find({ admin_id: req.session.user._id });
		const joinedGroups = await Member.find({ member_id: req.session.user._id }).populate('group_id');

		res.render('group', { user: req.session.user, myGroups: myGroups, joinedGroups: joinedGroups });

	} catch (error) {
		console.log(error);
	}
}

const createGroup = async (req, res) => {
	try {

		let newGroup = {
			admin_id: req.session.user._id,
			name: req.body.name,
			description: req.body.description
		}

		const cld_upload_stream = cloudinary.uploader.upload_stream({  
			folder: 'group-profiles'
		}, async function(error, result) {

			if(error) {
				throw new Error("Upload failed");
			}

			newGroup['image'] = result.secure_url;

			const group = new Group(newGroup);
			await group.save();

		});

		streamifier.createReadStream(req.file.buffer).pipe(cld_upload_stream);

		// const groups = await Group.find({ admin_id: req.session.user._id });

		// res.render('group', { success: true, message: 'Group created successfully', user: req.session.user, groupList: groups });
		res.status(303).redirect('/groups');
	} catch (error) {
		console.log(error);
		res.status(400).send({ success: false, message: error.message })
	}
}

const getMembers = async (req, res) => {
	try {

		const allUsers = await User.aggregate([
			{
				$lookup: {
					from: "members",
					localField: "_id",
					foreignField: "member_id",
					pipeline: [
						{
							$match: {
								$expr: {
									$and: [
										{ $eq: ["$group_id", new ObjectId(req.body.group_id)] }
									]
								}
							}
						}
					],
					as: "member"
				}
			},
			{
				$match: {
					"_id": {
						$nin: [new ObjectId(req.session.user._id)]
					}
				}
			}
		]);

		res.status(200).send({ success: true, message: 'Get users successfully !!', data: allUsers });

	} catch (error) {
		console.log(error);
		res.status(400).send({ success: false, message: error.message })
	}
}

const addMembers = async (req, res) => {
	try {

		if (!req.body.members) {

			res.status(200).send({ success: false, message: 'No members to add' });

		} else if (req.body.members.length > 10) {

			res.status(200).send({ success: false, message: 'Cannot add more than 10 members' });

		} else {

			await Member.deleteMany({ group_id: req.body.group_id });

			let data = [];
			const members = req.body.members;

			for (let i = 0; i < members.length; i++) {
				data.push({
					group_id: req.body.group_id,
					member_id: members[i]
				});
			}

			await Member.insertMany(data);

			res.status(200).send({ success: true, message: 'Members added successfully !!' });
		}

	} catch (error) {
		console.log(error);
		res.status(400).send({ success: false, message: error.message })
	}
}

const updateGroup = async (req, res) => {
	try {

		let updateObj;

		updateObj = {
			name: req.body.name,
			description: req.body.description
		}

		if (req.file === undefined) {

			await Group.findByIdAndUpdate({ _id: req.body.group_id }, {
				$set: updateObj
			});

		} else {

			const group = await Group.findOne({ _id: req.body.group_id });
			const public_id = "group-profiles/" + get_public_id(group.image);

			await cloudinary.uploader.destroy(public_id);

			const cld_upload_stream = cloudinary.uploader.upload_stream({  
				folder: 'group-profiles'
			}, async function(error, result) {
	
				if(error) {
					throw new Error("Upload failed");
				}

				updateObj['image'] = result.secure_url;

				await Group.findByIdAndUpdate({ _id: req.body.group_id }, {
					$set: updateObj
				});

			});
	
			streamifier.createReadStream(req.file.buffer).pipe(cld_upload_stream);
		}

		res.status(200).send({ success: true, message: 'Group updated successfully' });

	} catch (error) {
		console.log(error);
		res.status(400).send({ success: false, message: error.message })
	}
}

const deleteGroup = async (req, res) => {
	try {

		const groupData = await Group.findOne({ _id: req.body.group_id });
		const imageUrl = groupData.image;

		const public_id = "group-profiles/" + get_public_id(imageUrl);

		await cloudinary.uploader.destroy(public_id);

		await Group.deleteOne({ _id: req.body.group_id });
		await Member.deleteMany({ group_id: req.body.group_id });

		res.status(200).send({ success: true, message: 'Group deleted successfully' });

	} catch (error) {
		console.log(error);
		res.status(400).send({ success: false, message: error.message })
	}
}

const shareGroup = async (req, res) => {
	try {

		let group_id = req.params.id;
		
		if(ObjectId.isValid(group_id)) {

			let groupData = await Group.findOne({ _id: group_id });

			if (!groupData) {

				res.render('notfound', { message: '404 Group not found' });

			} else {

				let totalMembers = await Member.count({ group_id: group_id });
				let available = 10 - totalMembers;

				let isAdmin = groupData.admin_id == req.session.user._id ? true : false;
				let isJoind = await Member.count({ group_id: group_id, member_id: req.session.user._id });

				let resData = {
					group: groupData,
					totalMembers: totalMembers,
					available: available,
					isAdmin: isAdmin,
					isJoined: isJoind
				};

				res.render('group', { user: req.session.user, GroupJoinResData: resData });
			}
		} else {
			res.render('notfound', { message: 'Invalid Group Link' });
		}

	} catch (error) {
		console.log(error);
		res.status(400).send({ success: false, message: error.message })
	}
}

const joinGroup = async (req, res) => {
	try {

		const member = new Member({
			group_id: req.body.group_id,
			member_id: req.session.user._id
		});

		await member.save();

		res.send({ success: true, message: 'Joined the Group Successfully !' });

	} catch (error) {
		console.log(error);
		res.status(400).send({ success: false, message: error.message })
	}
}

const leaveGroup = async (req, res) => {
	try {

		await Member.deleteOne({ group_id: req.body.group_id, member_id: req.session.user._id });

		res.send({ success: true, message: 'Left Group Successfully !' });

	} catch (error) {
		console.log(error);
		res.status(400).send({ success: false, message: error.message })
	}
}

const saveGroupChat = async (req, res) => {
	try {

		const chat = new GroupChat({
			sender_id: req.body.sender_id,
			group_id: req.body.group_id,
			message: req.body.message
		})

		const newChat = await chat.save();

		const chatDetailed = await GroupChat.find({ _id: newChat._id }).populate('sender_id');

		res.status(200).send({ success: true, message: 'Chat stored successfully !!', data: chatDetailed });

	} catch (error) {
		console.log(error);
		res.status(400).send({ success: false, message: error.message })
	}
}

const deleteGroupChat = async (req, res) => {
	try {

		await GroupChat.deleteOne({ _id: req.body.chat_id });

		res.status(200).send({ success: true, message: 'Group chat deleted successfully !!' });

	} catch (error) {
		console.log(error);
		res.status(400).send({ success: false, message: error.message })
	}
}

const loadProfile = async (req, res) => {
	try {
		res.render('profile', { user: req.session.user });
	} catch (error) {
		console.log(error);
	}
}

const deleteProfile = async (req, res) => {
	try {

		const image = req.session.user.image;
		const user_id = req.session.user._id;

		const public_id = "user-profiles/" + get_public_id(image);
	
		await cloudinary.uploader.destroy(public_id);

		await User.deleteOne({ _id: user_id });
		await Member.deleteMany({ member_id: user_id });
		
		await Group.deleteMany({ admin_id: user_id });
		await GroupChat.deleteMany({ sender_id: user_id });
		await Chat.deleteMany({ $or: [{ sender_id : user_id }, { receiver_id: user_id }] });

		res.clearCookie('user');
		req.session.destroy();
		
		res.status(200).send({ success: true, message: 'Pofile deleted successfully !!' });

	} catch (error) {
		console.log(error);
		res.status(400).send({ success: false, message: error.message })
	}
}

const updateProfile = async (req, res) => {
	try {

		const imageUrl = req.session.user.image;
		const user_id = req.session.user._id;

		if(imageUrl !== "https://res.cloudinary.com/dpcqknniq/image/upload/v1692854657/user-profiles/default_umustr.png") {
			
			const public_id = "user-profiles/" + get_public_id(imageUrl);
			await cloudinary.uploader.destroy(public_id);
		}

		const cld_upload_stream = cloudinary.uploader.upload_stream({  
			folder: 'user-profiles'
		}, async function(error, result) {

			if(error) {
				throw new Error("Upload failed");
			}

			await User.findByIdAndUpdate({ _id: user_id }, {
				$set: {
					image: result.secure_url
				}
			});

			req.session.user.image = result.secure_url;
			req.session.save();
		});

		streamifier.createReadStream(req.file.buffer).pipe(cld_upload_stream);

		res.status(200).send({ success: true, message: 'Pofile updated successfully !!' });

	} catch (error) {
		console.log(error);
		res.status(400).send({ success: false, message: error.message })
	}
}

const forgotPasswordLoad = (req, res) => {
	try {
		res.render('forgot-password');
	} catch (error) {
		console.log(error);
	}
}

const forgotPassword = async (req, res) => {
	try {

		const email = req.body.email;
		const userData = await User.findOne({ email: email });

		if(userData) {

			let token = await Token.findOne({ user_id: userData._id });
			if (token) await token.deleteOne();

			let resetToken = crypto.randomBytes(32).toString("hex");
			const hash = await bcrypt.hash(resetToken, 10);

			const newToken = new Token({
				user_id: userData._id,
				token: hash,
				createdAt: Date.now(),
			});

			await newToken.save();

			const link = `${process.env.ORIGIN_URL}/password-reset?token=${resetToken}&id=${userData._id}`;

			sendEmail(userData.email, "Password Reset Request", {name: userData.username, link: link}, "../views/resetPasswordEmail.ejs");

			res.render('forgot-password', { success: true, message: 'Password reset link has been sent !!' })

		} else {
			res.render('forgot-password', { success: false,  message: 'No user registered with this email !!' })
		}

	} catch (error) {
		console.log(error);
	}
}

const passwordResetLoad = (req, res) => {
	try {
		res.render('reset-password');
	} catch (error) {
		console.log(error);
	}
}

const passwordReset = async (req, res) => {
	try {

		const { token, id } = req.query;

		let passwordResetToken = await Token.findOne({ user_id: id });

		if (!passwordResetToken) {
			
			res.render('reset-password', { success: false, message: 'Expired password reset link !!' })

		} else {

			const isValid = await bcrypt.compare(token, passwordResetToken.token);
			if (!isValid) {

				res.render('reset-password', { success: false, message: 'Invalid password reset link !!' })

			} else {
				
				const password = req.body.password;
				const hash = await bcrypt.hash(password, 10);

				await User.updateOne({ _id: id }, { 
						$set: { 
							password: hash 
						} 
					},
					{ new: true }
				);

				const user = await User.findById({ _id: id });

				//Send password reset confirmation mail
				sendEmail(user.email, "Password Reset Successfully", { name: user.username }, "../views/passwordResetSuccess.ejs");

				//Delete the token so can't using twice
				await passwordResetToken.deleteOne();

				res.render('reset-password', { success: true, message: 'Password reset successfull ! please login to enter !' });
			}
		}

	} catch (error) {
		console.log(error);
	}
}

const loadCalls = async (req, res) => {
	try {

		let searchUser = req.query.user || '';
		let queryObject = {};

		queryObject._id = { $nin: [req.session.user._id] };

		if (searchUser) {
			queryObject.username = { $regex: searchUser, $options: "i" }; 
		}

		const userList = await User.find(queryObject);

		res.render('call', { user: req.session.user, userList: userList });

	} catch (error) {
		console.log(error);
	}
}

const notFound = (req, res) => {

	res.render('notfound', { message: "404 Page not found" });

}

module.exports = {
	registerLoad,
	register,
	loginLoad,
	login,
	logout,
	dashboard,
	notFound,
	saveChat,
	deleteChat,
	updateChat,
	loadGroups,
	createGroup,
	getMembers,
	addMembers,
	updateGroup,
	deleteGroup,
	shareGroup,
	joinGroup,
	leaveGroup,
	saveGroupChat,
	deleteGroupChat,
	loadProfile,
	deleteProfile,
	updateProfile,
	forgotPasswordLoad,
	forgotPassword,
	passwordResetLoad,
	passwordReset,
	loadCalls
}