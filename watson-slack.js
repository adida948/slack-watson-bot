//------------------------------------------------------------------------------
// Copyright IBM Corp. 2017
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//    http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.
//------------------------------------------------------------------------------

var Botkit = require('botkit');
require('dotenv').load();
var request = require('request');

var middleware = require('botkit-middleware-watson')({
    username: process.env.CONVERSATION_USERNAME,
    password: process.env.CONVERSATION_PASSWORD,
    workspace_id: process.env.WORKSPACE_ID,
    version_date: '2016-09-20'
});

var controller = Botkit.slackbot({
    json_file_store: './db_slackbutton_bot/',
}).configureSlackApp(
    {
        clientId: process.env.SLACK_CLIENT_ID,
        clientSecret: process.env.SLACK_CLIENT_SECRET,
        scopes: ['bot'],
    }
    );

controller.setupWebserver(4000, function (err, webserver) {
    controller.createWebhookEndpoints(controller.webserver);

    controller.createOauthEndpoints(controller.webserver, function (err, req, res) {
        if (err) {
            res.status(500).send('ERROR: ' + err);
        } else {
            res.send('Success!');
        }
    });
});

var _bots = {};
function trackBot(bot) {
    _bots[bot.config.token] = bot;
}

function invokeAction(watsonDataOutput, bot, message) {
    let actionName = watsonDataOutput.context.action.name;

    switch (actionName) {
        case 'lookupWeather':
            lookupWeather(watsonDataOutput, bot, message);
            break;
        case 'lookupNews':
            lookupNews(watsonDataOutput,bot, message);
            break;
        default:
            bot.reply(message, "Sorry, I cannot execute what you've asked me to do");
    }
}

function lookupWeather(watsonDataOutput, bot, message) {
    let coordinates;
    let location = watsonDataOutput.context.action.location;

    switch (location) {
        case 'Munich':
            coordinates = '48.13/11.58';
            break;
        case 'Hamburg':
            coordinates = '53.55/9.99';
            break;
        case 'New York':
            coordinates = '42.34/-75.18';
            break;
        default:
            coordinates = '52.52/13.38'; // Berlin
    }

    let weatherUsername = process.env.WEATHER_USERNAME;
    let weatherPassword = process.env.WEATHER_PASSWORD;
    let weatherUrl = 'https://' + weatherUsername + ':' + weatherPassword + '@twcservice.mybluemix.net:443/api/weather/v1/geocode/' + coordinates + '/observations.json?units=m&language=en-US';

    request(weatherUrl, function (error, response, body) {
        var info = JSON.parse(body);
        let answer = "The current temperature in " + info.observation.obs_name
            + " is " + info.observation.temp + " °C"
        bot.reply(message, answer);
    })
}

function lookupNews(watsonDataOutput, bot, message) {
    let news = watsonDataOutput.context.action.news;
    // console.log(news);

    let newsUrl = 'https://newsapi.org/v1/articles?source=techcrunch&apikey=' + process.env.NEWS_TOKEN;

    request(newsUrl, function (error, response, body) {
        var info = JSON.parse(body);
        console.log(info);

        let answer = "The current top news in techcruch " + info.articles[0].title;
        bot.reply(message, answer);
    })
}

function handleWatsonResponse(bot, message) {
    let customSlackMessage = false;
    let actionToBeInvoked = false;
    if (message.watsonData) {
        if (message.watsonData.output) {
            if (message.watsonData.output.context) {
                if (message.watsonData.output.context.slack) {
                    customSlackMessage = true;
                }
                if (message.watsonData.output.context.action) {
                    actionToBeInvoked = true;
                }
            }
        }
    }
    if (actionToBeInvoked == true) {
        bot.reply(message, message.watsonData.output.text.join('\n'));
        invokeAction(message.watsonData.output, bot, message);
    }
    else {
        if (customSlackMessage == true) {
            bot.reply(message, message.watsonData.output.context.slack);
        }
        else {
            bot.reply(message, message.watsonData.output.text.join('\n'));
        }
    }
}

controller.on('interactive_message_callback', function (bot, message) {
    middleware.interpret(bot, message, function (err) {
        if (!err) {
            handleWatsonResponse(bot, message);
        }
    });
});

controller.on('create_bot', function (bot, config) {

    if (_bots[bot.config.token]) {
        // already online! do nothing.
    } else {
        bot.startRTM(function (err) {

            if (!err) {
                trackBot(bot);
            }

            bot.startPrivateConversation({ user: config.createdBy }, function (err, convo) {
                if (err) {
                    console.log(err);
                } else {
                    convo.say('I am a bot that has just joined your team');
                }
            });
        });
    }
});

controller.on('rtm_open', function (bot) {
    console.log('** The RTM api just connected!');
});

controller.on('rtm_close', function (bot) {
    console.log('** The RTM api just closed');
    // you may want to attempt to re-open
});

controller.hears('^stop', 'direct_message', function (bot, message) {
    bot.reply(message, 'Goodbye');
    bot.rtm.close();
});

controller.on('direct_message,direct_mention,mention', function (bot, message) {
    middleware.interpret(bot, message, function (err) {
        if (!err) {
            handleWatsonResponse(bot, message);
        }
    });
});

controller.storage.teams.all(function (err, teams) {
    if (err) {
        throw new Error(err);
    }
    // connect all teams with bots up to slack!
    for (var t in teams) {
        if (teams[t].bot) {
            controller.spawn(teams[t]).startRTM(function (err, bot) {
                if (err) {
                    console.log('Error connecting bot to Slack:', err);
                } else {
                    trackBot(bot);
                }
            });
        }
    }
});
