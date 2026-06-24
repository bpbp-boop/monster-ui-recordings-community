define(function (require) {
	var $ = require('jquery'),
		_ = require('lodash'),
		monster = require('monster');

	var app = {
		name: 'recordings-community',

		css: ['app'],

		i18n: {
			'en-US': { customCss: false },
			'fr-FR': { customCss: false },
			'nl-NL': { customCss: false }
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
				'url': 'accounts/{accountId}/recordings',
				'verb': 'GET',
			},
			'recordings-community.recordings.listByUser': {
				'url': 'accounts/{accountId}/users/{userId}/recordings',
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
			var self = this,
				i18n = self.i18n.active();

			monster.ui.generateAppLayout(self, {
				menus: [
					{
						tabs: [
							{
								text: i18n.menu.recordings,
								callback: self.renderRecordings
							},
							{
								text: i18n.menu.settings,
								menus: [{
									tabs: [
										{
											text: i18n.menu.account,
											callback: self.renderAccountSettings
										},
										{
											text: i18n.menu.users,
											callback: self.renderUserSettings
										},
										{
											text: i18n.menu.devices,
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
				parent = args.container || $('#recordings-community_app_container .app-content-wrapper');

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
						message: self.i18n.active().toasts.accountSettingsSaved,
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
					monster.ui.alert('error', self.i18n.active().errors.getAccount + JSON.stringify(response));
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
					monster.ui.alert('error', self.i18n.active().errors.updateAccount + JSON.stringify(response));
				}
			});
		},

		renderUserSettings: function (pArgs) {
			this.renderEndpointSettings('user', pArgs);
		},

		renderDeviceSettings: function (pArgs) {
			this.renderEndpointSettings('device', pArgs);
		},

		// per-type config for the call recording settings tabs; user and device
		// docs share the same call_recording shape (no perspective wrapper), so
		// they only differ by resources, id key and the displayed columns
		recordingEndpoints: {
			user: {
				secondaryLabelKey: 'username',
				getErrorKey: 'getUsers',
				updateErrorKey: 'updateUser',
				listResource: 'user.list',
				getResource: 'user.get',
				updateRequest: 'recordings-community.user.update',
				idKey: 'userId',
				getFields: function (doc) {
					return {
						name: ((doc.first_name || '') + ' ' + (doc.last_name || '')).trim() || doc.username,
						secondary: doc.username
					};
				}
			},
			device: {
				secondaryLabelKey: 'type',
				getErrorKey: 'getDevices',
				updateErrorKey: 'updateDevice',
				listResource: 'device.list',
				getResource: 'device.get',
				updateRequest: 'recordings-community.device.update',
				idKey: 'deviceId',
				getFields: function (doc) {
					return {
						name: doc.name,
						secondary: doc.device_type
					};
				}
			}
		},

		renderEndpointSettings: function (type, pArgs) {
			var self = this,
				config = self.recordingEndpoints[type],
				args = pArgs || {},
				parent = args.container || $('#recordings-community_app_container .app-content-wrapper');

			self.getEndpointsWithRecording(type, function (endpoints) {
				var template = $(self.getTemplate({
					name: 'settings-recording',
					data: {
						secondaryLabel: self.i18n.active().endpointSettings[config.secondaryLabelKey],
						endpoints: self.formatEndpoints(type, endpoints)
					}
				}));

				// each toggle saves the whole call_recording object for its
				// endpoint on change (no separate save button)
				template.on('change', '.recording-toggle', function () {
					var $row = $(this).closest('.endpoint-row'),
						endpointId = $row.data('endpoint-id'),
						readToggle = function (toggle) {
							return $row.find('.recording-toggle[data-type="' + toggle + '"]').prop('checked');
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

					self.updateEndpoint(type, endpointId, settings, function () {
						monster.ui.toast({
							type: 'success',
							message: self.i18n.active().toasts.settingsSaved
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

		formatEndpoints: function (type, endpoints) {
			var config = this.recordingEndpoints[type];

			var formattedEndpoints = endpoints.map(function (doc) {
				// endpoint docs (user/device) store the call_recording flags
				// directly, with no perspective wrapper (unlike the account doc)
				var recording = doc.call_recording || {},
					fields = config.getFields(doc);

				return {
					id: doc.id,
					name: fields.name,
					secondary: fields.secondary,
					inbound_external_enabled: recording?.inbound?.offnet?.enabled,
					outbound_external_enabled: recording?.outbound?.offnet?.enabled,
					inbound_internal_enabled: recording?.inbound?.onnet?.enabled,
					outbound_internal_enabled: recording?.outbound?.onnet?.enabled,
				};
			});

			formattedEndpoints.sort(function (a, b) {
				return (a.name || '').toLowerCase().localeCompare((b.name || '').toLowerCase());
			});

			return formattedEndpoints;
		},

		// the list summary doesn't include call_recording, so fetch each full
		// doc to know the current per-endpoint settings
		getEndpointsWithRecording: function (type, callback) {
			var self = this,
				config = self.recordingEndpoints[type];

			self.getEndpoints(type, function (endpoints) {
				var requests = {};

				_.each(endpoints, function (endpoint) {
					requests[endpoint.id] = function (cb) {
						var data = { accountId: self.accountId };
						data[config.idKey] = endpoint.id;

						self.callApi({
							resource: config.getResource,
							data: data,
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
					var fullEndpoints = _.filter(_.values(results), function (doc) {
						return doc !== null;
					});

					callback && callback(fullEndpoints);
				});
			});
		},

		getEndpoints: function (type, callback) {
			var self = this,
				config = self.recordingEndpoints[type];

			self.callApi({
				resource: config.listResource,
				data: {
					accountId: self.accountId
				},
				success: function (response) {
					callback && callback(response.data);
				},
				error: function (response) {
					monster.ui.alert('error', self.i18n.active().errors[config.getErrorKey]);
				}
			});
		},

		updateEndpoint: function (type, endpointId, settings, callback) {
			var self = this,
				config = self.recordingEndpoints[type],
				data = { accountId: self.accountId, data: settings };

			data[config.idKey] = endpointId;

			monster.request({
				resource: config.updateRequest,
				data: data,
				success: function (response) {
					callback && callback(response.data);
				},
				error: function (response) {
					monster.ui.alert('error', self.i18n.active().errors[config.updateErrorKey]);
				}
			});
		},

		renderRecordings: function (pArgs) {
			var self = this,
				args = pArgs || {},
				parent = args.container || $('#recordings-community_app_container .app-content-wrapper');

			self.recordingsListUsers(function (users) {
				var template = $(self.getTemplate({
					name: 'recordings',
					data: {
						user: monster.apps.auth.currentUser,
						users: users
					}
				}));

				monster.ui.tooltips(template);
				monster.ui.footable(template.find('.footable'));

				self.recordingsInitDatePicker(parent, template);
				self.bindRecordings(parent, template);

				parent
					.fadeOut(function () {
						$(this)
							.empty()
							.append(template)
							.fadeIn();

						// chosen must be initialised once the select is in the DOM
						// and then refreshed, otherwise the rendered options can
						// come out blank
						var $selectUser = template.find('.select-user');
						monster.ui.chosen($selectUser);
						$selectUser.trigger('chosen:updated');

						self.displayRecordings(parent);
					});
			});
		},

		// fetch the account's users to populate the "currently viewing" filter
		recordingsListUsers: function (callback) {
			var self = this;

			self.callApi({
				resource: 'user.list',
				data: {
					accountId: self.accountId,
					filters: {
						paginate: 'false'
					}
				},
				success: function (response) {
					var users = _.map(response.data, function (user) {
						return {
							id: user.id,
							name: monster.util.getUserFullName(user) || user.username || user.email || user.id
						};
					});

					users = _.sortBy(users, function (user) {
						return (user.name || '').toLowerCase();
					});

					callback && callback(users);
				},
				error: function () {
					callback && callback([]);
				}
			});
		},

		bindRecordings: function (parent, template) {
			var self = this;

			// reload the list when a different user (or "all users") is picked
			template.find('.select-user').on('change', function () {
				self.displayRecordings(parent);
			});

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

				monster.ui.confirm(self.i18n.active().confirmDeleteRecording, function () {
					self.deleteRecording(mediaId, function () {
						$row.remove();

						monster.ui.toast({
							type: 'success',
							message: self.i18n.active().toasts.recordingDeleted
						});
					});
				});
			});

			// show the bulk actions only while at least one row is selected, and
			// keep the master checkbox in sync with the per-row checkboxes
			var afterSelect = function () {
				if (template.find('.select-recording:checked').length) {
					template.find('.hidable').removeClass('hidden');
					template.find('.main-select-recording').prop('checked', true);
				} else {
					template.find('.hidable').addClass('hidden');
					template.find('.main-select-recording').prop('checked', false);
				}
			};

			template.on('change', '.select-recording', function (e) {
				e.stopPropagation();
				afterSelect();
			});

			template.find('.main-select-recording').on('click', function (e) {
				e.stopPropagation();

				var isChecked = $(this).prop('checked');

				template.find('.select-recording').prop('checked', isChecked);

				afterSelect();
			});

			template.find('.select-some-recordings').on('click', function () {
				var type = $(this).data('type');

				template.find('.select-recording').prop('checked', type === 'all');

				afterSelect();
			});

			template.find('.delete-recordings').on('click', function () {
				var recordingIds = template.find('.select-recording:checked').map(function () {
					return $(this).data('recording-id');
				}).get();

				if (recordingIds.length === 0) {
					return;
				}

				monster.ui.confirm(self.i18n.active().confirmDeleteSelected, function () {
					self.bulkDeleteRecordings(recordingIds, function () {
						monster.ui.toast({
							type: 'success',
							message: self.i18n.active().toasts.recordingsDeleted
						});

						self.displayRecordings(parent);
					});
				});
			});
		},

		displayRecordings: function (container) {
			var self = this,
				userId = container.find('#select_user').val();

			var fromDate = container.find('#startDate').datepicker('getDate');
			var toDate = container.find('#endDate').datepicker('getDate');

			// on first load the datepicker doesn't work. use defaults.
			if (fromDate instanceof Date === false) {
				var dates = monster.util.getDefaultRangeDates(self.appFlags.recordings.defaultRange);
				fromDate = dates.from;
				toDate = dates.to;
			}

			// reset the selection state and total before (re)loading
			container.find('.count-wrapper[data-type="total"] .count-text').html('?');
			container.find('.main-select-recording').prop('checked', false);
			container.find('.hidable').addClass('hidden');

			var table = container.find('#recordings-table');

			monster.ui.footable(table, {
				getData: function (filters, callback) {
					filters = $.extend(true, filters, {
						created_from: monster.util.dateToBeginningOfGregorianDay(fromDate),
						created_to: monster.util.dateToEndOfGregorianDay(toDate)
					});

					self.recordingGetRows(filters, userId, function ($rows, data) {
						container.find('.count-wrapper[data-type="total"] .count-text').html(data.length);

						callback && callback($rows, data);
					});

				},
				backendPagination: {
					enabled: true,
				}
			});
		},

		recordingGetRows: function (filters, userId, callback, startKey, continueData) {
			var self = this;

			continueData = continueData || [];

			if (typeof startKey !== 'undefined') {
				filters.start_key = startKey;
			}

			var onSuccess = function (response) {
				var mergedData = $.merge(continueData, response.data);

				if (response.next_start_key && startKey !== response.next_start_key) {
					self.recordingGetRows(filters, userId, callback, response.next_start_key, mergedData);
					return;
				}

				var recordings = mergedData;
				var formattedRecordings = self.formatRecordings(recordings);
				var $rows = $(self.getTemplate({
					name: 'recordings-rows',
					data: {
						recordings: formattedRecordings,
					}
				}));

				callback && callback($rows, recordings);
			};

			// list a single user's recordings when one is selected, otherwise
			// fall back to the account-wide listing ("all users")
			if (userId && userId !== 'all') {
				monster.request({
					resource: 'recordings-community.recordings.listByUser',
					data: {
						accountId: self.accountId,
						userId: userId,
						filters: filters
					},
					success: onSuccess,
					error: function () {
						callback && callback($(), []);
					}
				});
			} else {
				self.callApi({
					resource: 'recordings.list',
					data: {
						accountId: self.accountId,
						filters: filters
					},
					success: onSuccess
				});
			}
		},

		bulkDeleteRecordings: function (recordingIds, callback) {
			var self = this,
				requests = {};

			_.each(recordingIds, function (recordingId) {
				requests[recordingId] = function (cb) {
					monster.request({
						resource: 'recordings-community.recordings.delete',
						data: {
							accountId: self.accountId,
							recordingId: recordingId
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

			monster.parallel(requests, function () {
				callback && callback();
			});
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
					monster.ui.alert('error', self.i18n.active().errors.deleteRecording);
				}
			});
		},

		formatRecordings: function (recordings) {
			var self = this;

			var formattedData = recordings.map(function (recording) {
				// field names vary by KAZOO version / recorder: newer builds use
				// start_time and the doc id, older ones used start and a
				// Media-Recording-ID channel var
				var ccv = recording.custom_channel_vars || {},
					mediaId = recording.id || ccv['Media-Recording-ID'],
					startTime = recording.start_time || recording.start;

				return {
					call_id: recording.call_id,
					media_id: mediaId,
					direction: recording.direction || recording.call_direction || (recording.origin || '').split(' ')[0],
					caller_id_name: recording.caller_id_name,
					caller_id_number: recording.caller_id_number,
					callee_id_name: recording.callee_id_name,
					callee_id_number: recording.callee_id_number,
					datetime: monster.util.toFriendlyDate(startTime),
					date: monster.util.toFriendlyDate(startTime, 'date'),
					time: monster.util.toFriendlyDate(startTime, 'time'),
					timestamp: startTime,
					duration: monster.util.friendlyTimer(recording.duration),
					uri: self.apiUrl + 'accounts/' + self.accountId + '/recordings/' + mediaId + '?accept=audio/mpeg&auth_token=' + self.getAuthToken()
				};
			});

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
