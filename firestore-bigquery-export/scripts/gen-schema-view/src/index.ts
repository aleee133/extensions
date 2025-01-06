#!/usr/bin/env node

/*
 * Copyright 2019 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *    https://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import * as program from "commander";
import * as firebase from "firebase-admin";
import * as inquirer from "inquirer";

import { FirestoreBigQuerySchemaViewFactory, FirestoreSchema } from "./schema";

import { readSchemas } from "./schema-loader-utils";

const BIGQUERY_VALID_CHARACTERS = /^[a-zA-Z0-9_]+$/;
const FIRESTORE_VALID_CHARACTERS = /^[^\/]+$/;
const GCP_PROJECT_VALID_CHARACTERS = /^[a-z][a-z0-9-]{0,29}$/;

const validateInput = (value: any, name: string, regex: RegExp) => {
  if (!value || value === "" || value.trim() === "") {
    return `Please supply a ${name}`;
  }
  if (!value.match(regex)) {
    return `The ${name} must only contain letters or spaces`;
  }
  return true;
};

function collect(value, previous) {
  return previous.concat([value]);
}

const packageJson = require("../package.json");

program
  .name("gen-schema-views")
  .description(packageJson.description)
  .version(packageJson.version)
  .option(
    "--non-interactive",
    "Parse all input from command line flags instead of prompting the caller.",
    false
  )
  .option(
    "-P, --project <project>",
    "Firebase Project ID for project containing Cloud Firestore database."
  )
  .option(
    "-B, --big-query-project <big-query-project>",
    "Google Cloud Project ID for BigQuery (can be the same as the Firebase project ID)."
  )
  .option(
    "-d, --dataset <dataset>",
    "The ID of the BigQuery dataset containing a raw Cloud Firestore document changelog."
  )
  .option(
    "-t, --table-name-prefix <table-name-prefix>",
    "A common prefix for the names of all views generated by this script."
  )
  .option(
    "-f, --schema-files <schema-files>",
    "A collection of files from which to read schemas.",
    collect,
    []
  );

const questions = [
  {
    message: "What is your Firebase project ID?",
    name: "project",
    default: process.env.PROJECT_ID,
    type: "input",
    validate: (value) =>
      validateInput(value, "project ID", FIRESTORE_VALID_CHARACTERS),
  },
  {
    message:
      "What is your Google Cloud Project ID for BigQuery? (can be the same as the Firebase project ID)",
    name: "bigQueryProject",
    default: process.env.PROJECT_ID,
    type: "input",
    validate: (value) =>
      validateInput(value, "BigQuery project ID", GCP_PROJECT_VALID_CHARACTERS),
  },
  {
    message:
      "What is the ID of the BigQuery dataset the raw changelog lives in? (The dataset and the raw changelog must already exist!)",
    name: "dataset",
    type: "input",
    validate: (value) =>
      validateInput(value, "dataset ID", BIGQUERY_VALID_CHARACTERS),
  },
  {
    message:
      "What is the name of the Cloud Firestore collection for which you want to generate a schema view?",
    name: "tableNamePrefix",
    type: "input",
    validate: (value) =>
      validateInput(value, "table name prefix", BIGQUERY_VALID_CHARACTERS),
  },
  {
    message:
      "Where should this script look for schema definitions? (Enter a comma-separated list of, optionally globbed, paths to files or directories).",
    name: "schemaFiles",
    type: "input",
  },
];

interface CliConfig {
  projectId: string;
  bigQueryProjectId: string;
  datasetId: string;
  tableNamePrefix: string;
  schemas: { [schemaName: string]: FirestoreSchema };
}

async function run(): Promise<number> {
  // Get all configuration options via inquirer prompt or commander flags.
  const config: CliConfig = await parseConfig();

  // Set project ID so it can be used in BigQuery intialization
  process.env.PROJECT_ID = config.projectId;
  // BigQuery actually requires this variable to set the project correctly.
  process.env.GOOGLE_CLOUD_PROJECT = config.bigQueryProjectId;

  // Initialize Firebase
  if (!firebase.apps.length) {
    firebase.initializeApp({
      credential: firebase.credential.applicationDefault(),
      databaseURL: `https://${config.projectId}.firebaseio.com`,
    });
  }

  // @ts-ignore string not assignable to enum
  if (Object.keys(config.schemas).length === 0) {
    console.log(`No schema files found!`);
  }
  const viewFactory = new FirestoreBigQuerySchemaViewFactory(
    config.bigQueryProjectId
  );
  for (const schemaName in config.schemas) {
    await viewFactory.initializeSchemaViewResources(
      config.datasetId,
      config.tableNamePrefix,
      schemaName,
      config.schemas[schemaName]
    );
  }
  return 0;
}

async function parseConfig(): Promise<CliConfig> {
  program.parse(process.argv);
  if (program.nonInteractive) {
    if (
      program.project === undefined ||
      program.bigQueryProject === undefined ||
      program.dataset === undefined ||
      program.tableNamePrefix === undefined ||
      program.schemaFiles.length === 0
    ) {
      program.outputHelp();
      process.exit(1);
    }

    return {
      projectId: program.project,
      bigQueryProjectId: program.bigQueryProject,
      datasetId: program.dataset,
      tableNamePrefix: program.tableNamePrefix,
      schemas: readSchemas(program.schemaFiles),
    };
  }
  const { project, bigQueryProject, dataset, tableNamePrefix, schemaFiles } =
    await inquirer.prompt(questions);

  return {
    projectId: project,
    bigQueryProjectId: bigQueryProject,
    datasetId: dataset,
    tableNamePrefix: tableNamePrefix,
    schemas: readSchemas(
      schemaFiles.split(",").map((schemaFileName) => schemaFileName.trim())
    ),
  };
}

run()
  .then((result) => {
    console.log("done.");
    process.exit();
  })
  .catch((error) => {
    console.log(JSON.stringify(error));
    console.error(error.message);
    process.exit();
  });
