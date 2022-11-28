import {
  OutputChannel,
  ProgressLocation,
  ViewColumn,
  window,
  workspace,
} from "vscode";
import { getAuthConfig } from "../viya/auth";
import { appendLog } from "../LogViewer";

import { connectDirect } from "../viya/compute1/connect";
import { ComputeServer } from "../viya/compute1/server";
import { ComputeSession } from "../viya/compute1/session";
import { ComputeJob } from "../viya/compute1/job";

let compute: ComputeServer;
let session: ComputeSession | undefined;
let authConfig;

let outputChannel: OutputChannel;

async function setup() {
  //if (!authConfig) {
  //  authConfig = await getAuthConfig();
  // }

  //Maybe do recover syntax check mode

  if (!compute) {
    const config = workspace.getConfiguration("SAS.session");
    const host = String(config.get("host"));
    const url = new URL(host);
    const serverId = config.get("serverId");

    if (serverId) {
      compute = await connectDirect(url, String(serverId));
      await compute.connect();
      const state = await compute.getState({ wait: 4 });
      console.log("hello ", state);
    }
  }

  //TODO: need to check server status and make sure it can accept calls

  if (!session) {
    session = await compute.getSession();
  }
}

function getCode(outputHtml: boolean, selected = false): string {
  const editor = window.activeTextEditor;
  const doc = editor?.document;
  const code = selected ? doc?.getText(editor?.selection) : doc?.getText();

  return code
    ? outputHtml
      ? "ods html5;\n" + code + "\n;quit;ods html5 close;"
      : code
    : "";
}

async function logJob(job: ComputeJob) {
  //Create the output channel if needed
  if (!outputChannel)
    outputChannel = window.createOutputChannel("SAS Log", "sas-log");

  outputChannel.show();

  const log = await job.getLogStream();
  for await (const line of log) {
    appendLog(line.type);
    outputChannel.appendLine(line.line);
  }
}

async function computeRun(code: string) {
  const job = await session.submit(code);

  //start the logger
  const logging = logJob(job);

  //Wait for the job to finish
  //Wait on the job to complete
  let state = "";
  do {
    state = await job.getState({ onChange: true, wait: 2 });
  } while (await job.isDone(state));

  //job is done, finish streaming the logs
  await logging;
}

async function _run(selected = false) {
  const outputHtml = !!workspace
    .getConfiguration("SAS.session")
    .get("outputHtml");
  const code = getCode(outputHtml, selected);

  await window.withProgress(
    {
      location: ProgressLocation.Notification,
      title: "Connecting to SAS session...",
    },
    setup
  );

  //Run the code
  await window.withProgress(
    {
      location: ProgressLocation.Notification,
      title: "SAS code running...",
    },
    () =>
      computeRun(code).then((results) => {
        console.log("done");
      })
  );
}

export function run(): void {
  _run().catch((err) => {
    window.showErrorMessage(JSON.stringify(err));
  });
}

export function runSelected(): void {
  _run(true).catch((err) => {
    window.showErrorMessage(JSON.stringify(err));
  });
}

export async function closeSession(): Promise<void> {
  if (session) {
    await session.delete();
    session = undefined;
  }
}
