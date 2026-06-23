define(function (require) {
	var $ = require('jquery'),
		_ = require('lodash'),
		monster = require('monster');

	var app = {
		name: 'skeleton',

		css: ['app'],

		i18n: {
			'en-US': { customCss: false },
			'fr-FR': { customCss: false }
		},

		appFlags: {
			recordings: {
				maxRange: 31,
				defaultRange: 7,
			}
		},

		// Defines API requests not included in the SDK
		requests: {
			'recordings-community.recordings.list': {
				'url': 'accounts/{accountId}/{userId}/recordings',
				'verb': 'GET',
			},
			// there is no PATCH method included in the default sdk
			'recordings-community.account.update': {
				'url': 'accounts/{accountId}/',
				'verb': 'PATCH'
			},
			'recordings-community.recordings.delete': {
				'url': 'accounts/{accountId}/recordings/{recordingId}',
				'verb': 'DELETE'
			},
			// there is no PATCH method included in the default sdk
			'recordings-community.user.update': {
				'url': 'accounts/{accountId}/users/{userId}',
				'verb': 'PATCH'
			},
			'recordings-community.device.update': {
				'url': 'accounts/{accountId}/devices/{deviceId}',
				'verb': 'PATCH'
			}
		},

		// Define the events available for other apps
		subscribe: {},

		// Method used by the Monster-UI Framework, shouldn't be touched unless you're doing some advanced kind of stuff!
		load: function (callback) {
			var self = this;

			self.initApp(function () {
				callback && callback(self);
			});
		},

		// Method used by the Monster-UI Framework, shouldn't be touched unless you're doing some advanced kind of stuff!
		initApp: function (callback) {
			var self = this;

			// Used to init the auth token and account id of this app
			monster.pub('auth.initApp', {
				app: self,
				callback: callback
			});
		},

		// Entry Point of the app
		render: function (container) {
			var self = this;

			monster.ui.generateAppLayout(self, {
				menus: [
					{
						tabs: [
							{
								text: 'Recordings',
								callback: self.renderRecordings
							},
							{
								text: 'Settings',
								menus: [{
									tabs: [
										{
											text: 'Account',
											callback: self.renderAccountSettings
										},
										{
											text: 'Users',
											callback: self.renderUserSettings
										},
										{
											text: 'Devices',
											callback: self.renderDeviceSettings
										},
									],
								}]
							}
						]
					}
				]
			})
		},

		renderAccountSettings: function (pArgs) {
			var self = this,
				args = pArgs || {},
				parent = args.container || $('#recording_settings_app_container .app-content-wrapper');

			self.getAccount(function (account) {
				var inbound_external_enabled = false;
				var inbound_internal_enabled = false;
				var outbound_external_enabled = false;
				var outbound_internal_enabled = false;

				if (account?.call_recording?.account?.inbound?.offnet) {
					inbound_external_enabled = account.call_recording.account.inbound.offnet.enabled;
				}

				if (account?.call_recording?.account?.outbound?.offnet) {
					outbound_external_enabled = account.call_recording.account.outbound.offnet.enabled;
				}

				if (account?.call_recording?.account?.inbound?.onnet) {
					inbound_internal_enabled = account.call_recording.account.inbound.onnet.enabled;
				}

				if (account?.call_recording?.account?.outbound?.onnet) {
					outbound_internal_enabled = account.call_recording.account.outbound.onnet.enabled;
				}

				var template = $(self.getTemplate({
					name: 'settings-account',
					data: {
						user: monster.apps.auth.currentUser,
						inbound_external_enabled: inbound_external_enabled,
						outbound_external_enabled: outbound_external_enabled,

						inbound_internal_enabled: inbound_internal_enabled,
						outbound_internal_enabled: outbound_internal_enabled,
					}
				}));

				template.find('form .save').on('click', function () {
					var formData = monster.ui.getFormData('account-settings');
					console.log(formData);

					var settings = {
						"call_recording": {
							"account": {
								"inbound": {
									"offnet": {
										"enabled": formData['inbound-offnet'],
									},
									"onnet": {
										"enabled": formData['inbound-onnet'],
									}
								},
								"outbound": {
									"offnet": {
										"enabled": formData['outbound-offnet'],
									},
									"onnet": {
										"enabled": formData['outbound-onnet'],
									}
								}
							}
						}
					};

					self.updateAccount(settings);

					monster.ui.toast({
						type: 'success',
						message: 'Account call recording settings saved!',
					});
				});

				parent
					.fadeOut(function () {
						$(this)
							.empty()
							.append(template)
							.fadeIn();
					});

			});
		},


		getAccount: function (callback) {
			var self = this;

			self.callApi({
				resource: 'account.get',
				data: {
					accountId: self.accountId
				},
				success: function (response) {
					var account = response.data;
					callback && callback(account)
				},
				error: function (response) {
					monster.ui.alert('Issue getting account data'.response);
				}
			});
		},

		updateAccount: function (settings) {
			var self = this;

			monster.request({
				resource: 'recordings-community.account.update',
				data: {
					accountId: self.accountId,
					data: settings,
				},
				success: function (response) {
					var account = response.data;
					return account;
				},
				error: function (response) {
					monster.ui.alert('Issue getting account data'.response);
				}
			});
		},

		renderUserSettings: function (pArgs) {
			var self = this,
				args = pArgs || {},
				parent = args.container || $('#recording_settings_app_container .app-content-wrapper');

			self.getUsersWithRecording(function (users) {
				var template = $(self.getTemplate({
					name: 'settings-users',
					data: {
						users: self.formatUsers(users)
					}
				}));

				// each toggle saves the whole call_recording object for its
				// user on change (no separate save button)
				template.on('change', '.recording-toggle', function () {
					var $row = $(this).closest('.user-row'),
						userId = $row.data('user-id'),
						readToggle = function (type) {
							return $row.find('.recording-toggle[data-type="' + type + '"]').prop('checked');
						};

					var settings = {
						"call_recording": {
							"inbound": {
								"offnet": { "enabled": readToggle('inbound-offnet') },
								"onnet": { "enabled": readToggle('inbound-onnet') }
							},
							"outbound": {
								"offnet": { "enabled": readToggle('outbound-offnet') },
								"onnet": { "enabled": readToggle('outbound-onnet') }
							}
						}
					};

					self.updateUser(userId, settings, function () {
						monster.ui.toast({
							type: 'success',
							message: 'Call recording settings saved!'
						});
					});
				});

				parent
					.fadeOut(function () {
						$(this)
							.empty()
							.append(template)
							.fadeIn();

						monster.ui.footable(template.find('.footable'));
					});
			});
		},

		formatUsers: function (users) {
			var formattedUsers = users.map(function (user) {
				// user docs store the call_recording flags directly (no
				// perspective wrapper); the account doc's "endpoint" key is the
				// default endpoints inherit, not a user's own override
				var recording = user.call_recording || {},
					name = ((user.first_name || '') + ' ' + (user.last_name || '')).trim() || user.username;

				return {
					id: user.id,
					name: name,
					username: user.username,
					inbound_external_enabled: recording?.inbound?.offnet?.enabled,
					outbound_external_enabled: recording?.outbound?.offnet?.enabled,
					inbound_internal_enabled: recording?.inbound?.onnet?.enabled,
					outbound_internal_enabled: recording?.outbound?.onnet?.enabled,
				};
			});

			formattedUsers.sort(function (a, b) {
				return a.name.toLowerCase().localeCompare(b.name.toLowerCase());
			});

			return formattedUsers;
		},

		// the user.list summary doesn't include call_recording, so fetch each
		// full user doc to know the current per-user settings
		getUsersWithRecording: function (callback) {
			var self = this;

			self.getUsers(function (users) {
				var requests = {};

				_.each(users, function (user) {
					requests[user.id] = function (cb) {
						self.callApi({
							resource: 'user.get',
							data: {
								accountId: self.accountId,
								userId: user.id
							},
							success: function (response) {
								cb(null, response.data);
							},
							error: function () {
								cb(null, null);
							}
						});
					};
				});

				monster.parallel(requests, function (err, results) {
					var fullUsers = _.filter(_.values(results), function (user) {
						return user !== null;
					});

					callback && callback(fullUsers);
				});
			});
		},

		getUsers: function (callback) {
			var self = this;

			self.callApi({
				resource: 'user.list',
				data: {
					accountId: self.accountId
				},
				success: function (response) {
					callback && callback(response.data);
				},
				error: function (response) {
					monster.ui.alert('error', 'Issue getting users');
				}
			});
		},

		updateUser: function (userId, settings, callback) {
			var self = this;

			monster.request({
				resource: 'recordings-community.user.update',
				data: {
					accountId: self.accountId,
					userId: userId,
					data: settings,
				},
				success: function (response) {
					callback && callback(response.data);
				},
				error: function (response) {
					monster.ui.alert('error', 'Issue updating user');
				}
			});
		},

		renderDeviceSettings: function (pArgs) {
			var self = this,
				args = pArgs || {},
				parent = args.container || $('#recording_settings_app_container .app-content-wrapper');

			self.getDevicesWithRecording(function (devices) {
				var template = $(self.getTemplate({
					name: 'settings-devices',
					data: {
						devices: self.formatDevices(devices)
					}
				}));

				// each toggle saves the whole call_recording object for its
				// device on change (no separate save button)
				template.on('change', '.recording-toggle', function () {
					var $row = $(this).closest('.device-row'),
						deviceId = $row.data('device-id'),
						readToggle = function (type) {
							return $row.find('.recording-toggle[data-type="' + type + '"]').prop('checked');
						};

					var settings = {
						"call_recording": {
							"inbound": {
								"offnet": { "enabled": readToggle('inbound-offnet') },
								"onnet": { "enabled": readToggle('inbound-onnet') }
							},
							"outbound": {
								"offnet": { "enabled": readToggle('outbound-offnet') },
								"onnet": { "enabled": readToggle('outbound-onnet') }
							}
						}
					};

					self.updateDevice(deviceId, settings, function () {
						monster.ui.toast({
							type: 'success',
							message: 'Call recording settings saved!'
						});
					});
				});

				parent
					.fadeOut(function () {
						$(this)
							.empty()
							.append(template)
							.fadeIn();

						monster.ui.footable(template.find('.footable'));
					});
			});
		},

		formatDevices: function (devices) {
			var formattedDevices = devices.map(function (device) {
				// device docs store the call_recording flags directly, the same
				// way user docs do (endpoint docs have no perspective wrapper)
				var recording = device.call_recording || {};

				return {
					id: device.id,
					name: device.name,
					device_type: device.device_type,
					inbound_external_enabled: recording?.inbound?.offnet?.enabled,
					outbound_external_enabled: recording?.outbound?.offnet?.enabled,
					inbound_internal_enabled: recording?.inbound?.onnet?.enabled,
					outbound_internal_enabled: recording?.outbound?.onnet?.enabled,
				};
			});

			formattedDevices.sort(function (a, b) {
				return (a.name || '').toLowerCase().localeCompare((b.name || '').toLowerCase());
			});

			return formattedDevices;
		},

		// the device.list summary doesn't include call_recording, so fetch each
		// full device doc to know the current per-device settings
		getDevicesWithRecording: function (callback) {
			var self = this;

			self.getDevices(function (devices) {
				var requests = {};

				_.each(devices, function (device) {
					requests[device.id] = function (cb) {
						self.callApi({
							resource: 'device.get',
							data: {
								accountId: self.accountId,
								deviceId: device.id
							},
							success: function (response) {
								cb(null, response.data);
							},
							error: function () {
								cb(null, null);
							}
						});
					};
				});

				monster.parallel(requests, function (err, results) {
					var fullDevices = _.filter(_.values(results), function (device) {
						return device !== null;
					});

					callback && callback(fullDevices);
				});
			});
		},

		getDevices: function (callback) {
			var self = this;

			self.callApi({
				resource: 'device.list',
				data: {
					accountId: self.accountId
				},
				success: function (response) {
					callback && callback(response.data);
				},
				error: function (response) {
					monster.ui.alert('error', 'Issue getting devices');
				}
			});
		},

		updateDevice: function (deviceId, settings, callback) {
			var self = this;

			monster.request({
				resource: 'recordings-community.device.update',
				data: {
					accountId: self.accountId,
					deviceId: deviceId,
					data: settings,
				},
				success: function (response) {
					callback && callback(response.data);
				},
				error: function (response) {
					monster.ui.alert('error', 'Issue updating device');
				}
			});
		},

		renderRecordings: function (pArgs) {
			var self = this,
				args = pArgs || {},
				parent = args.container || $('#recordings_app_container .app-content-wrapper'),
				template = $(self.getTemplate({
					name: 'recordings',
					data: {
						user: monster.apps.auth.currentUser
					}
				}));

			monster.ui.chosen(template.find('.filter-direction'));
			monster.ui.footable(template.find('.footable'));

			self.recordingsInitDatePicker(parent, template);

			template.on('click', '.play-recording', function (e) {
				var $row = $(this).parents('.recording-row'),
					$activeRows = template.find('.recording-row.active');

				if (!$row.hasClass('active') && $activeRows.length !== 0) {
					return;
				}

				e.stopPropagation();

				var mediaId = $row.data('recording-id');

				template.find('table').addClass('highlighted');
				$row.addClass('active');

				self.playRecording(template, mediaId);
			});

			template.on('click', '.delete-recording', function (e) {
				e.stopPropagation();

				var $row = $(this).parents('.recording-row'),
					mediaId = $row.data('recording-id');

				monster.ui.confirm('Are you sure you want to delete this recording?', function () {
					self.deleteRecording(mediaId, function () {
						$row.remove();

						monster.ui.toast({
							type: 'success',
							message: 'Recording deleted!'
						});
					});
				});
			});

			parent
				.fadeOut(function () {
					$(this)
						.empty()
						.append(template)
						.fadeIn();

					self.displayRecordings(parent);
				});
		},

		displayRecordings: function (container) {
			var self = this;

			var fromDate = $('#startDate').datepicker('getDate');
			var toDate = $('#endDate').datepicker('getDate');

			// on first load the datepicker doesn't work. use defaults.
			if (fromDate instanceof Date === false) {
				var dates = monster.util.getDefaultRangeDates(self.appFlags.recordings.defaultRange),
				fromDate = dates.from,
				toDate = dates.to;
			}

			var table = container.find('#recordings-table');

			monster.ui.footable(table, {
				getData: function (filters, callback) {
					console.log(filters);
					filters = $.extend(true, filters, {
						created_from: monster.util.dateToBeginningOfGregorianDay(fromDate),
						created_to: monster.util.dateToEndOfGregorianDay(toDate)
					});

					self.recordingGetRows(filters, function ($rows, data) {
						callback && callback($rows, data);
					});

				},
				backendPagination: {
					enabled: true,
				}
			});
		},

		recordingGetRows: function (filters, callback, startKey, continueData) {
			var self = this;

			continueData = continueData || [];

			if (typeof startKey !== 'undefined') {
				filters.start_key = startKey;
			}

			console.log(filters);

			self.callApi({
				resource: 'recordings.list',
				data: {
					accountId: self.accountId,
					filters: filters
				},
				success: function (response) {
					var mergedData = $.merge(continueData, response.data);

					if (response.next_start_key && startKey !== response.next_start_key) {
						self.recordingGetRows(filters, callback, response.next_start_key, mergedData);
						return;
					}

					var recordings = mergedData;
					var formattedRecordings = self.formatRecordings(recordings)
					$rows = $(self.getTemplate({
						name: 'recordings-rows',
						data: {
							recordings: formattedRecordings,
						}
					}));

					callback && callback($rows, recordings);
				},
			})
		},

		deleteRecording: function (recordingId, callback) {
			var self = this;

			monster.request({
				resource: 'recordings-community.recordings.delete',
				data: {
					accountId: self.accountId,
					recordingId: recordingId
				},
				success: function (response) {
					callback && callback(response.data);
				},
				error: function (response) {
					monster.ui.alert('error', 'Issue deleting recording');
				}
			});
		},

		formatRecordings: function (recordings) {
			var self = this;

			var formattedData = recordings.map(recording => ({
				call_id: recording.call_id,
				media_id: recording.custom_channel_vars['Media-Recording-ID'],
				direction: recording.origin.split(' ')[0],
				caller_id_name: recording.caller_id_name,
				caller_id_number: recording.caller_id_name,
				callee_id_name: recording.callee_id_name,
				callee_id_number: recording.callee_id_number,
				datetime: monster.util.toFriendlyDate(recording.start),
				timestamp: recording.start,
				duration: monster.util.friendlyTimer(recording.duration),
				uri: `${self.apiUrl}accounts/${self.accountId}/recordings/${recording.custom_channel_vars['Media-Recording-ID']}?accept=audio/mpeg&auth_token=${self.getAuthToken()}`,
			}));

			return formattedData;
		},

		recordingsInitDatePicker: function (parent, template) {
			var self = this,
				dates = monster.util.getDefaultRangeDates(self.appFlags.recordings.defaultRange),
				fromDate = dates.from,
				toDate = dates.to;

			var optionsDatePicker = {
				container: template,
				range: self.appFlags.recordings.maxRange
			};

			monster.ui.initRangeDatepicker(optionsDatePicker);

			template.find('#startDate').datepicker('setDate', fromDate);
			template.find('#endDate').datepicker('setDate', toDate);

			template.find('.apply-filter').on('click', function (e) {
				self.displayRecordings(parent);
			});

			template.find('.toggle-filter').on('click', function () {
				template.find('.filter-by-date').toggleClass('active');
			});
		},

		playRecording: function (template, mediaId) {
			var self = this,
				$row = template.find('.recording-row[data-recording-id="' + mediaId + '"]');

			template.find('table').addClass('highlighted');
			$row.addClass('active');

			$row.find('.duration, .actions').hide();

			var uri = `${self.apiUrl}accounts/${self.accountId}/recordings/${mediaId}?accept=audio/mpeg&auth_token=${self.getAuthToken()}`;

			templateCell = $(self.getTemplate({
				name: 'cell-recording-player',
				data: {
					uri: uri
				}
			}));

			$row.append(templateCell);

			var closePlayerOnClickOutside = function (e) {
				if ($(e.target).closest('.recording-player').length) {
					return;
				}
				e.stopPropagation();
				closePlayer();
			},
				closePlayer = function () {
					$(document).off('click', closePlayerOnClickOutside);
					self.removeOpacityLayer(template, $row);
				};

			$(document).on('click', closePlayerOnClickOutside);

			templateCell.find('.close-player').on('click', closePlayer);

			// Autoplay in JS. For some reason in HTML, we can't pause the stream properly for the first play.
			templateCell.find('audio').get(0).play();
		},

		removeOpacityLayer: function (template, $activeRows) {
			$activeRows.find('.recording-player').remove();
			$activeRows.find('.duration, .actions').show();
			$activeRows.removeClass('active');
			template.find('table').removeClass('highlighted');
		},
	};



	return app;
});
