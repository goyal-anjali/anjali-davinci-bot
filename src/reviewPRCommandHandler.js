adoPRCard = require("./adaptiveCards/reviewPRCommand.json");
const { AdaptiveCards } = require("@microsoft/adaptivecards-tools");
const { CardFactory, MessageFactory } = require("botbuilder");
const axios = require('axios');
const openai = require('openai');
const adoToken = '<YOUR ADO PAT TOKEN>>';
const { OpenAIClient, AzureKeyCredential } = require("@azure/openai");
const endpoint = "<YOUR MODEL ENDPOINT>>";
const azureApiKey = "<API_KEY>";

class ReviewPRCommandHandler {
  triggerPatterns = /^reviewpr (.*?)$/i;

  async handleCommandReceived(context, message) {
    // verify the command arguments which are received from the client if needed.
    console.log(`App received message: ${message.text}`);
    console.log(message.matches[1]);

    const argumentsRegex = /^reviewpr (.*?)$/i;
    const argumentsMatch = message.text.match(argumentsRegex);
    var cardData = {
      body: "Incorrect arguments"
    };

    console.log(argumentsMatch);

    if (argumentsMatch && argumentsMatch.length > 1) {
      const argumentsString = argumentsMatch[1].trim();
      const argumentList = argumentsString.split(' ');
      console.log(argumentList);

      // get organization, project, reponame and PR Id from PR link   
      const regex = /^https:\/\/([\w-]+)\.visualstudio\.com\/([\w\s%-]+)\/_git\/([\w-]+)\/pullrequest\/(\d+)$/;
      const matches = argumentList[0].match(regex);

      if (!matches || matches.length < 5) {
        throw new Error('Invalid PR link format');
      }

      const organization = matches[1];
      const project = matches[2];
      const repository = matches[3];
      const pullRequestId = matches[4];

      const changedFiles = await this.getChangedFilesInLatestIteration(organization, project, repository, pullRequestId);

      for (const changedFile of changedFiles) {
        try {
          const fileContent = await this.getFileContentFromPR(organization, project, repository, pullRequestId, changedFile);
          const comments = await this.getLLMResultFromPrompt(fileContent);

          // TODO: get a list of comments from the LLM along with line numbers
          // and add each comment separately at the respective line number

          await this.addReviewCommentToFile(organization, project, repository, pullRequestId, changedFile, 2, comments);
        }
        catch (error) {
          console.error('Error:', error.response);
        }
      }

      // render your adaptive card for reply message
      cardData = {
        title: "PR Review In Progress",
        body: "Review Bot has added review comments. Please review and make necessary changes.",
        comments: "",
        prLink: argumentList[0]
      };
    }

    const cardJson = AdaptiveCards.declare(adoPRCard).render(cardData);
    return MessageFactory.attachment(CardFactory.adaptiveCard(cardJson));
  }

  async getFileContentFromPR(organization, project, repository, pullRequestId, filePath) {
    try {
      const headers = {
        Authorization: `Basic ${Buffer.from(`PAT:${adoToken}`).toString('base64')}`,
        'X-TFS-FedAuthRedirect': 'Suppress', // we can't handle auth redirect so - suppress
        Accept: "text/plain",
        ResponseType: "arraybuffer",
        Connection: 'keep-alive',
        'Keep-Alive': 'timeout=1500, max=100'
      };

      // Get the pull request
      const prResponse = await axios.get(`https://dev.azure.com/${organization}/${project}/_apis/git/repositories/${repository}/pullRequests/${pullRequestId}`, { headers });

      // Get the source branch
      var sourceBranch = prResponse.data.sourceRefName;

      const regex = /refs\/heads\/(.+)/;
      const match = sourceBranch.match(regex);

      if (match && match.length > 1) {
        sourceBranch = match[1];
        console.log(sourceBranch); // Output: "branchname"
      } else {
        console.log("No match found.");
      }

      // Get the file content in the source branch
      const fileContent = await axios.get(`https://dev.azure.com/${organization}/${project}/_apis/git/repositories/${repository}/items?versionDescriptor.version=${encodeURIComponent(sourceBranch)}&path=${encodeURIComponent(filePath)}`, { headers });

      return fileContent.data;
    } catch (error) {
      console.error('Error:', error.response);
      throw error;
    }
  }

  // Function to get the list of changed files in the latest iteration of a pull request
  async getChangedFilesInLatestIteration(organization, project, repository, pullRequestId) {
    try {
      const headers = {
        Authorization: `Basic ${Buffer.from(`PAT:${adoToken}`).toString('base64')}`,
        'X-TFS-FedAuthRedirect': 'Suppress', // we can't handle auth redirect so - suppress
      };

      // Get the iterations of the pull request
      const iterationsResponse = await axios.get(`https://dev.azure.com/${organization}/${project}/_apis/git/repositories/${repository}/pullRequests/${pullRequestId}/iterations`, { headers });

      // Get the latest iteration number
      const latestIteration = iterationsResponse.data.value.sort((a, b) => b.id - a.id)[0];

      // Get the changes in the latest iteration
      const changesResponse = await axios.get(`https://dev.azure.com/${organization}/${project}/_apis/git/repositories/${repository}/pullRequests/${pullRequestId}/iterations/${latestIteration.id}/changes`, { headers });

      // Extract the file paths from the changes
      const changedFiles = changesResponse.data.changeEntries.map(change => change.item.path);

      return changedFiles;
    } catch (error) {
      console.error('Error:', error.response.data);
      throw error;
    }
  }

  async getLLMResultFromPrompt(code) {

    var promptText = JSON.stringify("Review the following code:" + code + "Make a list of bugs in the above code. If this list is empty, respond with noErrorResponse, else respond with the list.");

    // const content = JSON.stringify(body);
    try {

      const client = new OpenAIClient(endpoint, new AzureKeyCredential(azureApiKey));
      const deploymentId = "cosmosdb-livesitechatbot";
      const result = await client.getCompletions(deploymentId, promptText, {
        maxTokens: 6000
      });

      for (const choice of result.choices) {
        console.log(choice.message);
      }
      return result;
    }
    catch (error) {
      console.error('Error:', error.response.data);
      throw error;
    }
  }

  async addReviewCommentToFile(organization, project, repository, pullRequestId, filePath, lineNumber = 0, comment) {
    comment = `Generated by Review Bot:\n${comment}`
    const thread = {
      comments: [
        {
          parentCommentId: 0,
          content: comment,
          commentType: 1
        }
      ],
      status: 1,
      threadContext: {
        filePath: filePath,
        leftFileEnd: null,
        leftFileStart: null,
        rightFileEnd: {
          line: lineNumber + 1,
          offset: 0
        },
        rightFileStart: {
          line: lineNumber,
          offset: 0
        }
      }
    };

    try {
      const headers = {
        Authorization: `Basic ${Buffer.from(`PAT:${adoToken}`).toString('base64')}`,
        'X-TFS-FedAuthRedirect': 'Suppress', // we can't handle auth redirect so - suppress
      };

      const baseUrlString = `https://dev.azure.com/${organization}/${project}/_apis`;
      const url = `${baseUrlString}/git/repositories/${repository}/pullRequests/${pullRequestId}/threads?api-version=3.0`;

      const response = await axios.post(url, thread, { headers });

      console.log('Review comment added successfully:', response.data);
    } catch (error) {
      console.error('Failed to add review comment:', error.message);
    }
  }
}

module.exports = {
  ReviewPRCommandHandler,
};
