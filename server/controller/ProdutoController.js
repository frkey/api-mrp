'use strict';

var Joi = require('joi'),
Boom = require('boom'),
httpTools = require('./../utils/httpTools'),
Produto = require('../model/ProdutoModel').Produto,
mongoose = require('mongoose'),
fs = require('fs'),
fsExtra = require('fs-extra'),
uuidV4 = require('uuid/v4'),
flattenMongooseValidationError = require('flatten-mongoose-validation-error'),
findRemoveSync = require('find-remove');

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

exports.create = {
	validate: {
		payload: {
			code:          Joi.string().required(),
			name:          Joi.string().required(),
			family:        Joi.string(),
			productType:   Joi.string(), 
			description:   Joi.string(),
			amountInStock: Joi.number(),
			unit:          Joi.string(),
			leadTime:      Joi.number(),
			purchasePrice: Joi.number()
		} 
	},
	handler: function (request, reply) {

		var config = new DocNode();

		config.document = request.payload;

		Produto.insertDocNode(config, function (err, product) {
			if (!err) {
				return reply(product).created('/produtos/' + product.cod); 
			}
			console.log(err)
			return reply(Boom.badData(err));
		});
	}
};

exports.remove = {
	validate: {
		params : {
			_id: Joi.string().required()
		}
	},
	handler: function(request, reply) {

		var config = new DocNode();

		config.document._id = request.params._id;

		Produto.deleteDocNode(config, function(err, doc) {
			if (!err) {
				return reply().code(204);
			}
			return reply(Boom.badData(JSON.stringify(err)));
		})
	}
};

exports.update = {
	validate : {
		payload : {
			code:          Joi.string().required(),
			name:          Joi.string().required(),
			family:        Joi.string(),
			productType:   Joi.string(),
			description:   Joi.string(),
			amountInStock: Joi.number(),
			unit:          Joi.string(),
			leadTime:      Joi.number(),
			purchasePrice: Joi.number()
		},
		params: {
			_id:  		   Joi.string().required()
		}
	},
	handler: function (request, reply) {
		var config = new DocNode();

		config.document = request.payload;
		config.document._id = request.params._id;

		Produto.updateDocNode(config, function(err, obj) {
			if (!err) {
				return reply().code(204);
			}

			console.log(err);
			return reply(Boom.badData(err));
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
		httpTools.searchQuery(null, request.query, null, function(search, filters){
			Produto.paginate(search, filters, function(err, product){
				if (!err) {
					return reply(product);
				}
				return reply(Boom.badImplementation(err));

			});
		}, function(err) {
			reply(Boom.BadData(err));
		});
	}
};

exports.getProductById = {
	validate: {
		params: {
			_id: Joi.string().required()
		}
	},
	handler: function(request, reply) {
		Produto.findById(request.params._id, function(err, doc) {
			if (err) {
				return reply(Boom.badData('Product not found'));
			}
			return reply(doc);
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
			quantity: Joi.number().required()
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

		Produto.associateNodes(config, function(err, obj) {
			if(!err) {
				return reply().code(204);
			}

			console.log(err);
			return reply(Boom.badData(err));
		});
	}
};

exports.getChildren = {
	validate: {
		params: {
			_id: Joi.string().required()
		}
	},
	handler: function(request, reply) {
		
		var searchConfig = {
			depth: 0,
			direction: '<',
			recordsPerPage: 2,
			page: 0,
			document : {}
		};

		searchConfig.document._id = request.params._id;

		Produto.getRelationships(searchConfig, function(err, obj) {
			if (!err) {
				return reply(extractTreeData(obj));
			}

			console.log(err);
			return reply(Boom.badData(JSON.stringify(err)));
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
		config.node.data.parentNode._id = _parentId;
		config.node.data.sonNode._id = _childId;

		Produto.disassociate(config, function(err, obj) {
			if (!err) {
				return reply().code(204);
			}

			console.log(err);
			return reply(Boom.badData(JSON.stringify(err)));
		});
	}
};


function extractTreeData(obj) {

	var ret = {};

	ret.id = obj._id;
	ret.text = obj.code + ' - ' + obj.name;
	ret.data = obj.relationProperties;

	if (obj.relationships) {
		ret.children = obj.relationships.map(extractTreeData);
	}
	return ret;
}