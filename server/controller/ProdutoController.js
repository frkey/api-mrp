'use strict';

var Joi = require('joi'),
	Boom = require('boom'),
	httpTools = require('./../utils/httpTools'),
	Produto = require('../model/ProdutoModel').Produto,
	mongoose = require('mongoose'),
	uuidV4 = require('uuid/v4'),
	_ = require('lodash'),
	formatOutput = require('../utils/format'),
	log = require('../utils/log').Product;

mongoose.Promise = require('q').Promise;
Joi.objectId = require('joi-objectid')(Joi);

function DocNode() {
	this.node= {
		data:{
			nodeData: {},
			parentNode: {},
			sonNode: {},
			relationNode: {}
		},
		isMultiDelete: false,
		direction: '<',
		relationName: 'COMPOSED_BY',
		labels:{
			nodeLabel:'Product',
			parentLabel:'Product',
			sonLabel:'Product'
		}
	},
	this.document= {}
};

const productPayloadValidate = {
	code:          Joi.string().required(),
	name:          Joi.string().required(),
	family:        Joi.string(),
	productType:   Joi.number(),
	description:   Joi.string(),
	amountInStock: Joi.number(),
	unit:          Joi.string(),
	leadTime:      Joi.number(),
	purchasePrice: Joi.number(),
	_id: 		   Joi.string() 
}

exports.create = {
	validate: {
		payload: productPayloadValidate
	},
	handler: function (request, reply) {

		if (!isValidProductType(request.payload)) {
			return reply(Boom.badData(request.i18n.__("product.invalidProductType")));
		}

		var config = new DocNode();

		config.document = request.payload;
		delete config.document._id;

		Produto.insertDocNode(config, function (err, product) {
			if (!err) {
				return reply(formatOutput(product, ['__v', 'DELETED'])).created('/products/' + product._id);
			}

			switch (err.error) {
				case 'duplicateKeyError':
					return reply(Boom.badData(request.i18n.__("product.codeNotunique")));
					break;
				case 'invalidConfigError':
				case 'mongoError':
				case 'neo4jError':
				default:
					log.error(request, err);
					return reply(Boom.badImplementation());
			}
		});
	}
};

exports.remove = {
	validate: {
		params : {
			_id: Joi.objectId().required()
		}
	},
	handler: function(request, reply) {

		var config = new DocNode();

		config.document._id = request.params._id;

		Produto.softDeleteDocNode(config, function(err, doc) {
			if (!err) {
				reply().code(204);
				return;
			}
			
			switch (err.error) {
				case 'notFound':
					return reply(Boom.notFound(request.i18n.__("product.notFound")));
					break;
				default:
					log.error(request, err);
					return reply(Boom.badImplementation());
			}
		})
	}
};

exports.update = {
	validate: {
		payload: productPayloadValidate,
		params: {
			_id:  		   Joi.objectId().required()
		}
	},
	handler: function (request, reply) {

		if (!isValidProductType(request.payload)) {
			return reply(Boom.badData(request.i18n.__("product.invalidProductType")));
		}

		var config = new DocNode();

		config.document = request.payload;
		config.document._id = request.params._id;

		Produto.updateDocNode(config, function(err, obj) {
			if (!err) {
				return reply().code(204);
			}

			switch (err.error) {
				case 'notFound':
					return reply(Boom.notFound(request.i18n.__("product.notFound")));
					break;
				default:
					log.error(request, err);
					return reply(Boom.badImplementation());
			}
		});
	}
};

exports.getProducts = {
	validate: {
		query: {
			_page: Joi.number().integer(),
			_limit: Joi.number().integer(),
			_search:  Joi.string()
		}
	},
	handler: function(request, reply) {
		httpTools.searchQuery(null, request.query, null, function(search, filters) {
			search["$and"] = [{DELETED: {$eq: false}}];
			Produto.paginate(search, filters, function(err, product){
				if (!err) {
					return reply(formatOutput(product, ['__v', 'DELETED']));
				}

				switch (err.error) {
					case 'notFound':
						return reply(Boom.notFound(request.i18n.__("product.notFound")));
						break;
					default:
						log.error(request, err);
						return reply(Boom.badImplementation(err));
				}
			});
		}, function(err) {
			reply(Boom.badRequest(request.i18n.__( "httpUtils.badQuery" )));
		});
	}
};

exports.getProductById = {
	validate: {
		params: {
			_id: Joi.objectId().required()
		}
	},
	handler: function(request, reply) {
		Produto.findById(request.params._id, function(err, doc) {
			if (err) {
				log.error(request, err)
				return reply(Boom.badImplementation);
			}

			if (!doc || doc.DELETED != false) {
				return reply(Boom.notFound(request.i18n.__("product.notFound")));
			}
			try {
				var ret = formatOutput(doc, ['__v', 'DELETED']);
			}
			catch (e) {
				log.error(request, e);
			}
			return reply(ret);
		});
	}
};

exports.addChildren = {
	validate: {
		params: {
			_parentId: Joi.string().required(),
			_childId: Joi.string().required()
		},
		payload: {
			quantity: Joi.number().required(),
			relationshipId: Joi.string()
		}
	},
	handler: function(request, reply) {

		if (request.params._parentId == request.params._childId) {
			return reply(Boom.badData('Product cannot reference itself as a child'));
		}

		var config = new DocNode();

		config.node.data.parentNode._id = request.params._parentId;
		config.node.data.sonNode._id = request.params._childId;
		config.node.data.relationNode.quantity = request.payload.quantity;
		if (request.payload.relationshipId) {
			config.node.data.relationNode.relationshipId = request.payload.relationshipId;
		}
		else {
			config.node.data.relationNode.relationshipsId = uuidV4();
		}

		validateChildren(request.params._parentId, request.params._childId, function(err) {
			if (err) {
				return reply(Boom.badData(request.i18n.__("produto.addChildren.circularDependencies")));
			}

			Produto.associateNodes(config, function(err, obj) {
				if(!err) {
					return reply().code(204);
				}

				switch (err.error) {
					case 'notFound':
						return reply(Boom.notFound(request.i18n.__("product.notFound")));
						break;
					default:
						log.error(request, err);
						return reply(Boom.badImplementation());
				}
			});
		});
	}
};

exports.getChildren = {
	validate: {
		params: {
			_id: Joi.objectId().required()
		}
	},
	handler: function(request, reply) {

		var searchConfig = {
			depth: 0,
			direction: '<',
			recordsPerPage: 10,
			page: 0,
			document : {}
		};

		searchConfig.document._id = request.params._id;

		Produto.getRelationships(searchConfig, function(err, obj) {
			if (!err) {
				var docs = [];
				docs.push(extractTreeData(obj.docs));
				return reply(docs);
			}

			switch(err.error) {
				case 'notFound':
					return reply(Boom.notFound(request.i18n.__("product.notFound")));
					break;
				default:
					log.error(request, err);
					return reply(Boom.badImplementation());
			}
		});
	}
};

exports.removeChildren = {
	validate: {
		params: {
			_parentId: Joi.string().required(),
			_childId: Joi.string().required()
		}
	},
	handler: function(request, reply) {

		var config = new DocNode();
		config.node.data.parentNode._id = request.params._parentId;
		config.node.data.sonNode._id = request.params._childId;

		Produto.disassociate(config, function(err, obj) {
			if (!err) {
				return reply().code(204);
			}

			switch(err.error) {
				case 'notFound':
					return reply(Boom.notFound(request.i18n.__("product.notFound")));
					break;
				default:
					log.error(request, err);
					return reply(Boom.badImplementation());

			}
		});
	}
};

function validateChildren(parentId, childId, callback) {

	var searchConfig = {
		depth: 0,
		direction: '<',
		recordsPerPage: 10,
		page: 0,
		document : {}
	};

	searchConfig.document._id = childId;

	Produto.getDependencies(searchConfig, function(err, obj) {
		if (err) {
			return callback(err);
		}

		if (obj.indexOf(parentId) != -1) {
		    return callback(422);
		}
		else {
			return callback(undefined)
		}
	});
}

function extractTreeData(obj) {

	var ret = {};

	ret.id = uuidV4();
	ret.text = obj.code + ' - ' + obj.name;
	ret.data = obj.relationProperties;
	if(ret.data == undefined){
		ret.data = {};
	}

	ret.data._id = obj._id;

	if (obj.relationships) {
		ret.children = obj.relationships.map(extractTreeData);
	}
	return ret;
}



function arrayObjectIndexOf(myArray, searchTerm, property) {
	for(var i = 0, len = myArray.length; i < len; i++) {
		if (myArray[i][property] == searchTerm) {
			return i;
		}
	}
	return -1;
}

function isValidProductType(data) {
	return _.includes([1,2], data.productType);
}