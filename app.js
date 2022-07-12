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
											callback: function () { }
										},
										{
											text: 'Devices',
											callback: function () { }
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
