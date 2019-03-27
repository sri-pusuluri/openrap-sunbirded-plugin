import DatabaseSDK from '../sdk/database/index';
import { Inject, Config } from 'typescript-ioc';
import * as path from 'path';
import { Manifest, } from '@project-sunbird/ext-framework-server/models';
import * as glob from 'glob';
import FileSDK from '../sdk/file';
import * as _ from "lodash";
import * as uuid from 'uuid';
import Response from './../utils/response';
import config from './../config'
import Content from './content';
import { logger } from '../logger';



export class Page {
    @Inject
    private databaseSdk: DatabaseSDK;

    @Inject
    private fileSDK: FileSDK;

    @Inject
    private content: Content;


    constructor(manifest: Manifest) {
        this.databaseSdk.initialize(manifest.id);
    }

    public insert() {
        let pagesFiles = path.join(__dirname, '..', 'data', 'pages', '**', '*.json');
        let files = glob.sync(pagesFiles, {});

        files.forEach(async (file) => {
            let page = await this.fileSDK.readJSON(file);
            let doc = _.get(page, 'result.response');
            let _id = doc.id;
            //TODO: handle multiple inserts of same page
            await this.databaseSdk.insert('page', doc, _id);
        });
    }

    get(req: any, res: any) {
        let reqBody = req.body;

        let pageReqObject = {
            selector: {
                name: _.get(reqBody, 'request.name')
            }
        }

        let pageReqFilter = _.get(reqBody, 'request.filters');
        let contentSearchFields = config.get('CONTENT_SEARCH_FIELDS').split(',');

        let filters = _.pick(pageReqFilter, contentSearchFields);
        filters = _.mapValues(filters, function (v) { return _.isString(v) ? [v] : v; });

        this.databaseSdk.find('page', pageReqObject).then(data => {
            data = _.map(data.docs, doc => _.omit(doc, ['_id', '_rev']))
            if (data.length <= 0) {
                res.status(404);
                return res.send(Response.error("api.page.assemble", 404));
            }
            let page = data[0];

            let sectionPromises = [];
            let sections = [];
            page.sections.forEach((section) => {
                let searchQuery = JSON.parse(section.searchQuery);
                let sectionFilters = _.get(searchQuery, 'request.filters');
                sectionFilters = _.pick(sectionFilters, contentSearchFields);
                sectionFilters = _.mapValues(sectionFilters, function (v) { return _.isString(v) ? [v] : v; });
                let dbFilter = {}

                _.forEach(contentSearchFields, (v) => {
                    sectionFilters[v] = sectionFilters[v] || [];
                    filters[v] = filters[v] || [];
                    let uniqFilter = _.uniq(_.concat(sectionFilters[v], filters[v]));
                    if (uniqFilter && uniqFilter.length) {
                        dbFilter[v] = uniqFilter;
                    }
                })

                sectionPromises.push(this.getSection(dbFilter, section));
            })
            Promise.all(sectionPromises)
                .then((sections) => {
                    _.sortBy(sections, [function (o) { return o.index; }]);
                    let result = {
                        response: {
                            id: _.get(page, 'id'),
                            name: _.get(page, 'name'),
                            sections: sections
                        }
                    }
                    return res.send(Response.success("api.page.assemble", result));
                })
                .catch(err => {
                    logger.error("Error while getting all the page sections", err)
                    return res.send(Response.error("api.page.assemble", 500));
                })

        }).catch(err => {
            if (err.statusCode === 404) {
                res.status(404)
                return res.send(Response.error("api.page.assemble", 404));
            } else {
                let statusCode = err.statusCode || 500;
                res.status(statusCode)
                return res.send(Response.error("api.page.assemble", statusCode));
            }
        })
    }

    getSection(filter, section) {

        return new Promise((resolve, reject) => {
            this.content.searchInDB(filter).then(data => {
                if (data.docs.length) {
                    section.count = data.docs.length
                    let contents = _.map(data.docs, doc => _.omit(doc, ['_id', '_rev']))
                    section.contents = contents;
                    resolve(section)
                } else {
                    section.count = 0;
                    section.contents = null;
                    resolve(section)
                }
            }).catch(err => {
                section.count = 0;
                section.contents = null;
                resolve(section)
                logger.error("Error while getting page section", err)
            });
        })
    }

}
