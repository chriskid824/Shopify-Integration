const { PubSub } = require('@google-cloud/pubsub');
const pubsub = new PubSub();
const topicObjects = {};

function getTopic(name) {
  if (topicObjects.hasOwnProperty(name)) return topicObjects[name];
  const topic = topicObjects[name] = pubsub.topic(name);
  return topic;
}

async function publishMessage(message, topicName) {
  if (typeof(message) !== 'string') {
    message = JSON.stringify(message);
  }

  const topic = getTopic(topicName);
  const data = Buffer.from(message);

  const callback = (err, messageId) => {
    if (err) {
      const errMsg = `[${messageId}] unable to publish message to ${topicName}`;
      console.error(err);
      throw new Error(errMsg);
    }
  };

  topic.publishMessage({ data }, callback);
}

exports.publishMessage = publishMessage;
