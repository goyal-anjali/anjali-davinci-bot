adoPRCard = require("./adaptiveCards/activePRCommand.json");
const { AdaptiveCards } = require("@microsoft/adaptivecards-tools");
const { CardFactory, MessageFactory } = require("botbuilder");
const axios = require('axios');

class ADOServiceCommandHandler {
  triggerPatterns = /^listprs (.*?)$/i;

  async handleCommandReceived(context, message) {
    // verify the command arguments which are received from the client if needed.
    console.log(`App received message: ${message.text}`);
    console.log(message.matches[1]);

    const argumentsRegex = /^listprs (.*?)$/i;
    const argumentsMatch = message.text.match(argumentsRegex);
    var cardData = {
      body: "Incorrect arguments"
    };

    console.log(argumentsMatch);

    if (argumentsMatch && argumentsMatch.length > 1) {
      const argumentsString = argumentsMatch[1].trim();
      const argumentList = argumentsString.split(' ');
      console.log(argumentList);

      // Authenticate the API request
      // ENTER YOUR PAT HERE TILL WE FIND A BETTER WAY TO AUTHENTICATE THE REQUEST
      const token = "<ENETER TOKEN HERE>";
      const headers = {
        Authorization: `Basic ${Buffer.from(`PAT:${token}`).toString('base64')}`,
        'X-TFS-FedAuthRedirect': 'Suppress', // we can't handle auth redirect so - suppress
      };

      // query ADO to get a list of active PRs in the repo
      const response = await axios.get(`https://dev.azure.com/${argumentList[0]}/${argumentList[1]}/_apis/git/repositories/${argumentList[2]}/pullrequests?status=active`, { headers });
      // console.log(response);

      // render your adaptive card for reply message
      cardData = {
        title: "List of Active PRs",
        body: `Here are the active PRs:`,
      };

      // Parse the response and extract the list of active PRs
      const activePRs = response.data.value;
      for (const pr of activePRs) {
        const prTitle = pr.title;
        const prUrl = pr.url;
        console.log(`PR Title: ${prTitle}; PR URL: ${prUrl}`);

        adoPRCard.body.push(
          {
            type: 'TextBlock',
            text: `[${prTitle}](${prUrl})`,
          }
        )
      }
    }

    const cardJson = AdaptiveCards.declare(adoPRCard).render(cardData);
    return MessageFactory.attachment(CardFactory.adaptiveCard(cardJson));
  }
}

module.exports = {
  ADOServiceCommandHandler,
};