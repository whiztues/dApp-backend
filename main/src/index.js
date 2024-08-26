// Include ethers and dotenv
const { ethers } = require("ethers");
require("dotenv").config();

const rollup_server = process.env.ROLLUP_HTTP_SERVER_URL;
console.log("HTTP rollup_server url is " + rollup_server);

// Utility functions
function str2hex(payload) {
  return ethers.utils.hexlify(ethers.utils.toUtf8Bytes(payload));
}

function hex2str(hex) {
  return ethers.utils.toUtf8String(ethers.utils.arrayify(hex));
}

let tasks = [];
let bids = [];

async function handle_advance(data) {
  console.log("Received advance request data " + JSON.stringify(data));

  const payload = hex2str(data.payload);
  const sender = data.msg_sender;

  let input;
  try {
    input = JSON.parse(payload);
  } catch (e) {
    console.error("Error parsing JSON", e);
    return "reject";
  }

  const { action, task_id, description, deadline, bid_amount } = input;

  if (action === "create_task") {
    const task = {
      task_id: tasks.length + 1,
      description,
      deadline,
      creator: sender,
      bids: [],
    };
    tasks.push(task);
    await postNotice(`Task created with ID: ${task.task_id}`);
  } else if (action === "place_bid") {
    const task = tasks.find((t) => t.task_id == task_id);
    if (task) {
      const bid = {
        bid_id: task.bids.length + 1,
        bidder: sender,
        bid_amount,
      };
      task.bids.push(bid);
      bids.push({ task_id, ...bid });
      await postNotice(`Bid placed on Task ID: ${task_id}`);
    } else {
      await postReport(`Task ID ${task_id} not found`);
      return "reject";
    }
  } else if (action === "select_bid") {
    const task = tasks.find((t) => t.task_id == task_id);
    if (task && task.creator === sender) {
      const selected_bid = task.bids.find((b) => b.bid_id == input.bid_id);
      if (selected_bid) {
        await postNotice(
          `Bid ID ${input.bid_id} selected for Task ID: ${task_id}`
        );
      } else {
        await postReport(
          `Bid ID ${input.bid_id} not found for Task ID: ${task_id}`
        );
        return "reject";
      }
    } else {
      await postReport(`Task ID ${task_id} not found or unauthorized action`);
      return "reject";
    }
  }

  return "accept";
}

async function handle_inspect(data) {
  console.log("Received inspect request data " + JSON.stringify(data));

  const payload = hex2str(data.payload);
  let input;
  try {
    input = JSON.parse(payload);
  } catch (e) {
    console.error("Error parsing JSON", e);
    return "reject";
  }

  const { action, task_id } = input;

  let result = "Action not supported";

  if (action === "view_task") {
    const task = tasks.find((t) => t.task_id == task_id);
    result = task ? JSON.stringify(task) : `Task ID ${task_id} not found`;
  } else if (action === "view_bids") {
    const task_bids = bids.filter((b) => b.task_id == task_id);
    result =
      task_bids.length > 0
        ? JSON.stringify(task_bids)
        : `No bids found for Task ID ${task_id}`;
  }

  await postReport(result);
  return "accept";
}

// Helper functions to interact with Cartesi Rollup APIs
async function postNotice(message) {
  await fetch(rollup_server + "/notice", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ payload: str2hex(message) }),
  });
}

async function postReport(message) {
  await fetch(rollup_server + "/report", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ payload: str2hex(message) }),
  });
}

// Main loop
var handlers = {
  advance_state: handle_advance,
  inspect_state: handle_inspect,
};

var finish = { status: "accept" };

(async () => {
  while (true) {
    const finish_req = await fetch(rollup_server + "/finish", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(finish),
    });

    console.log("Received finish status " + finish_req.status);

    if (finish_req.status == 202) {
      console.log("No pending rollup request, trying again");
    } else {
      const rollup_req = await finish_req.json();
      var handler = handlers[rollup_req["request_type"]];
      finish["status"] = await handler(rollup_req["data"]);
    }
  }
})();
