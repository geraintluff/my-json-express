var url = require('url');
var querystring = require('querystring');
var myJson = require('my-json');
var async = require('async');

var exports = module.exports = function (classGroup, mysqlPool) {
	var result = {
		init: function (request, response, next) {
			request.myJson = request.myJson || {};
			if (mysqlPool) {
				request.myJson.group = classGroup.cacheWithPool(mysqlPool);
			} else {
				request.myJson.group = classGroup();
			}
			next();
		}
	};
	function classWrapper(className, myJsonClass) {
		var result = {};
		result.search = function (searchParams) {
			defaultOrdering = {};
			defaultOrdering.limit = searchParams.limit || 10;
			defaultOrdering.offset = searchParams.offset || 0;
			defaultOrdering.orderBy = searchParams.orderBy || null;
			
			var searchFunction = searchParams.search || function (request, callback) {
				process.nextTick(callback.bind(null, null, {}));
			};

			return function (request, response, next) {
				var cachedClass = request.myJson.group[className];

				searchFunction(request, function (err, searchSchema, searchOrdering) {
					if (err) return next(err);
					
					var ordering = {
						limit: intOrNull(request.query.limit) || defaultOrdering.limit,
						offset: intOrNull(request.query.offset) || defaultOrdering.offset,
						orderBy: searchOrdering || defaultOrdering.orderBy
					};

					cachedClass.search(searchSchema, ordering, function (err, results) {
						if (searchParams.schema) {
							response.links({
								describedby: searchParams.schema
							});
						}
						if (ordering.offset > 0) {
							var prevUrl = replaceQuery(request.originalUrl, {
								limit: ordering. limit,
								offset: Math.max(0, ordering.offset - ordering.limit)
							});
							response.links({
								prev: prevUrl
							});
						}
						if (results.length == ordering.limit) {
							var nextUrl = replaceQuery(request.originalUrl, {
								limit: ordering.limit,
								offset: ordering.offset + ordering.limit
							});
							response.links({
								next: nextUrl
							});
						}
						async.map(results, function (item, callback) {
							if (typeof item._get === 'function') {
								item._get(request, callback);
							} else {
								callback(null, item);
							}
						}, function (err, results) {
							if (err) return next(err);
							response.json(results);
						});
					});
				});
			};
		};
		result.load = function () {
			var paramNames = Array.prototype.slice.call(arguments, 0);
			return function (request, response, next) {
				var key = [];
				for (var i = 0; i < paramNames.length; i++) {
					key.push(request.params[paramNames[i]]);
				}
				request.myJson.group[className].openMultiple({single: key}, function (err, result) {
					if (err) return next(err);
					var single = result.single;
					if (!single) {
						return next(404);
					}
					request.myJson[className] = single;
					next();
				});
			};
		};
		result.open = function () {
			var paramNames = [];
			var index = 0;
			while (typeof arguments[index] === 'string') {
				paramNames.push(arguments[index]);
				index++;
			}
			var openParams = arguments[index] || {};

			var loadFunction = result.load.call(this, paramNames);
			return function (request, response, next) {
				loadFunction(request, response, function (err) {
					if (err) return next(err);
					var result = request.myJson[className];
					if (openParams.schema) {
						response.links({describedby: openParams.schema});
					}
					if (typeof result._get === 'function') {
						result._get(request, function (err, getResult) {
							if (err) return next(err);
							response.json(getResult);
						});
					} else {
						response.json(result);
					}
				});
			}
		};
		return result;
	};
	for (var key in classGroup.classes) {
		result[key] = classWrapper(key, classGroup.classes[key]);
	}
	return result;
};

function intOrNull(input) {
	var result = parseInt(input, 10);
	return isNaN(result) ? null : result;
}

var replaceQuery = exports.replaceQuery = function replaceQuery(inputUrl, replacements) {
	var parsed = url.parse(inputUrl);
	parsed.query = querystring.parse(parsed.query);
	for (var key in replacements) {
		parsed.query[key] = replacements[key];
	}
	parsed.query = querystring.stringify(parsed.query);
	parsed.search = parsed.query ? ('?' + parsed.query) : parsed.query;
	return url.format(parsed);
}
