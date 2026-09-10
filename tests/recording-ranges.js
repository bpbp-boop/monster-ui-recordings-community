const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const chunkSeconds = 30 * 86400;
function run(seconds, userId, failAt) {
	const requests = [];
	let app, result, callbacks = 0;
	const $ = value => value;
	$.extend = Object.assign;
	$.merge = (target, source) => target.push(...source);
	function request(options) {
		requests.push(options);
		if (requests.length === failAt) {
			options.error();
			return;
		}
		const filters = options.data.filters;
		assert.ok(filters.created_to - filters.created_from < 2682000);
		assert.equal(options.data.userId, userId === 'all' ? undefined : userId);
		assert.equal(options.resource, userId === 'all' ? 'recordings.list' : 'recordings-community.recordings.listByUser');
		// Each chunk has two pages; reuse the cursor to check it resets between chunks.
		options.success({
			data: [{ id: requests.length, start_time: filters.created_from + (filters.start_key ? 0 : 1) }],
			next_start_key: filters.start_key ? undefined : 'page2'
		});
	}
	vm.runInNewContext(fs.readFileSync('app.js', 'utf8'), {
		define(factory) {
			app = factory(name => ({ jquery: $, lodash: {}, monster: { request } })[name]);
		}
	});
	app.callApi = request;
	app.formatRecordings = data => data;
	app.getTemplate = options => options.data.recordings;
	const filters = { created_from: 63900000000, created_to: 63900000000 + seconds - 1, start_key: 'stale', page_size: 50 };
	const original = { ...filters };
	app.recordingGetRows(filters, userId, (rows, data) => { callbacks++; result = data; });
	assert.deepEqual(filters, original);
	assert.equal(callbacks, 1);
	if (failAt) {
		assert.equal(requests.length, failAt);
		assert.equal(result.length, 0);
		return;
	}
	assert.equal(requests.length, Math.ceil(seconds / chunkSeconds) * 2);
	assert.equal(result.length, requests.length);
	for (let i = 0; i < requests.length; i += 2) {
		const first = requests[i].data.filters;
		const second = requests[i + 1].data.filters;
		assert.equal(first.start_key, undefined);
		assert.equal(second.start_key, 'page2');
		assert.equal(first.created_from, second.created_from);
		assert.equal(first.created_to, second.created_to);
		assert.equal(first.page_size, 50);
		if (i) assert.equal(first.created_to + 1, requests[i - 2].data.filters.created_from);
	}
	assert.equal(requests[0].data.filters.created_to, filters.created_to);
	assert.equal(requests.at(-1).data.filters.created_from, filters.created_from);
	for (let i = 1; i < result.length; i++) assert.ok(result[i - 1].start_time >= result[i].start_time);
}
for (const user of ['all', 'user-123']) {
	for (const seconds of [86400, 7 * 86400, chunkSeconds, chunkSeconds + 1, 90 * 86400, 366 * 86400 + 3600]) run(seconds, user);
	run(366 * 86400, user, 3);
}
console.log('Recording range tests passed (bounds, pagination, user filters, ordering, failures).');
