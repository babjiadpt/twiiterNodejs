const express = require("express");
const app = express();
const path = require("path");
const { open } = require("sqlite");
const sqlite3 = require("sqlite3");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");

app.use(express.json());

const dbPath = path.join(__dirname, "twitterClone.db");
let db = null;

const initializeDbAndServer = async () => {
  try {
    db = await open({
      filename: dbPath,
      driver: sqlite3.Database,
    });
    app.listen(3000, () => {
      console.log("db server started at http://localhost3000");
    });
  } catch (e) {
    console.log(`DB ERROR: ${e.message}`);
  }
};

initializeDbAndServer();

const jwtTokenMiddleware = async (request, response, next) => {
  let jwtToken;
  const authHeader = request.headers["authorization"];

  if (authHeader !== undefined) {
    jwtToken = authHeader.split(" ")[1];
  }

  if (jwtToken === undefined) {
    response.status(401);
    response.send("Invalid JWT Token");
  } else {
    jwt.verify(jwtToken, "MY_SECRET_TOKEN", async (error, payload) => {
      if (error) {
        response.status(401);
        response.send("Invalid JWT Token");
      } else {
        request.username = payload;
        next();
      }
    });
  }
};

const tweetResponse = (dbObject) => ({
  username: dbObject.username,
  tweet: dbObject.tweet,
  dateTime: dbObject.date_time,
});

const follows = async (request, response, next) => {
  const { tweetId } = request.params;
  let isFollowing = await db.get(`
      SELECT * FROM follower
      WHERE
      follower_user_id =  (SELECT user_id FROM user WHERE username = "${request.username}")
      AND
      following_user_id = (SELECT user.user_id FROM tweet NATURAL JOIN user WHERE tweet_id = ${tweetId});
      `);

  if (isFollowing === undefined) {
    response.status(401);
    response.send("Invalid Request");
  } else {
    next();
  }
};

//API: 1
//user register;
app.post("/register/", async (request, response) => {
  const { username, password, name, gender } = request.body;
  const getUserDetailsQuery = `
    SELECT 
       *
    FROM 
        user
    WHERE
        username = '${username}';`;

  const dbUser = await db.get(getUserDetailsQuery);

  if (dbUser === undefined) {
    if (password.length < 6) {
      response.status(400);
      response.send("Password is too short");
    } else {
      const hashedPassword = await bcrypt.hash(password, 5);
      const createUserQuery = `
        INSERT INTO 
                user (username, name, password, gender) 
        VALUES (
                '${username}', 
                '${name}',
                '${hashedPassword}', 
                '${gender}'
                );`;
      await db.run(createUserQuery);
      response.status(200);
      response.send("User created successfully");
    }
  } else {
    response.status(400);
    response.send("User already exists");
  }
});

//API: 2;
//user login;
app.post("/login", async (request, response) => {
  const { username, password } = request.body;
  const selectUserQuery = `SELECT * FROM user WHERE username = '${username}'`;
  const dbUser = await db.get(selectUserQuery);

  if (dbUser === undefined) {
    response.status(400);
    response.send("Invalid user");
  } else {
    const isPasswordMatched = await bcrypt.compare(password, dbUser.password);
    if (isPasswordMatched === true) {
      const jwtToken = jwt.sign(username, "MY_SECRET_TOKEN");
      response.send({ jwtToken });
    } else {
      response.status(400);
      response.send("Invalid password");
    }
  }
});

//API: 3;
//Returns the latest tweets of people whom the user follows. Return 4 tweets at a time;
app.get("/user/tweets/feed/", jwtTokenMiddleware, async (request, response) => {
  const latestTweets = await db.all(`
    SELECT
        tweet.tweet_id,
        tweet.user_id,
        user.username,
        tweet.tweet,
        tweet.date_time
    FROM
        follower LEFT JOIN tweet ON tweet.user_id = follower.following_user_id
        LEFT JOIN user ON follower.following_user_id = user.user_id
    WHERE 
        follower.follower_user_id = (SELECT user_id FROM user WHERE username = "${request.username}")
    ORDER BY 
        tweet.date_time DESC
    LIMIT 4;
    `);
  response.send(latestTweets.map((item) => tweetResponse(item)));
});

//API : 4;
//Returns the list of all names of people whom the user follows;
app.get("/user/following", jwtTokenMiddleware, async (request, response) => {
  const following = await db.all(`
    SELECT
        user.name
    FROM
        follower LEFT JOIN user ON follower.following_user_id = user.user_id
    WHERE 
        follower.follower_user_id = (SELECT user_id FROM user WHERE username = "${request.username}");
  `);
  response.send(following);
});

//API : 5;
//Returns the list of all names of people who follows the user;
app.get("/user/followers/", jwtTokenMiddleware, async (request, response) => {
  const followers = await db.all(`
    SELECT 
        user.name
    FROM
        follower LEFT JOIN user ON follower.follower_user_id = user.user_id
    WHERE 
        follower.following_user_id = (SELECT user_id FROM user WHERE username = "${request.username}");
    `);
  response.send(followers);
});

//API: 6;
//get tweet with tweet id;
app.get(
  "/tweets/:tweetId/",
  jwtTokenMiddleware,
  follows,
  async (request, response) => {
    const { tweetId } = request.params;

    const { tweet, date_time } = await db.get(`
        SELECT tweet,date_time FROM tweet WHERE tweet_id = ${tweetId};`);

    const { likes } = await db.get(`
        SELECT COUNT(like_id) AS likes FROM like WHERE tweet_id = ${tweetId};`);

    const { replies } = await db.get(`
        SELECT COUNT(reply_id) AS replies FROM reply WHERE tweet_id = ${tweetId};`);

    response.send({ tweet, likes, replies, dateTime: date_time });
  }
);

//API: 7;
//get all likes of a tweet with tweet id if the user follows the tweeter;
app.get(
  "/tweets/:tweetId/likes/",
  jwtTokenMiddleware,
  follows,
  async (request, response) => {
    const { tweetId } = request.params;
    const likedBy = await db.all(`
        SELECT
            user.username 
        FROM 
            like NATURAL JOIN user
        WHERE
            tweet_id = ${tweetId};
    `);
    response.send({ likes: likedBy.map((item) => item.username) });
  }
);

//API: 8;
//get all replies of a tweet with tweet id if the user follows the tweeter;
app.get(
  "/tweets/:tweetId/replies/",
  jwtTokenMiddleware,
  follows,
  async (request, response) => {
    const { tweetId } = request.params;
    const replies = await db.all(`
        SELECT
            user.name, 
            reply.reply
        FROM
            reply NATURAL JOIN user
        WHERE tweet_id = ${tweetId};
    `);
    response.send({ replies });
  }
);

//API: 9;
//Returns a list of all tweets of the user;
app.get("/user/tweets/", jwtTokenMiddleware, async (request, response) => {
  const myTweets = await db.all(`
    SELECT
        tweet.tweet,
        COUNT(distinct like.like_id) AS likes,
        COUNT(distinct reply.reply_id) AS replies,
        tweet.date_time
    FROM
        tweet LEFT JOIN like on tweet.tweet_id = like.tweet_id
        LEFT JOIN reply on tweet.tweet_id = reply.tweet_id
    WHERE
        tweet.user_id = (SELECT user_id FROM user WHERE username = "${request.username}")
    GROUP BY
        tweet.tweet_id;
    `);
  response.send(
    myTweets.map((item) => {
      const { date_time, ...rest } = item;
      return { ...rest, dateTime: date_time };
    })
  );
});

//API : 10;
//Create a tweet in the tweet table;
app.post("/user/tweets/", jwtTokenMiddleware, async (request, response) => {
  const { tweet } = request.body;
  const { user_id } = await db.get(
    `SELECT 
         user_id
     FROM 
        user 
    WHERE username = "${request.username}"`
  );

  await db.run(`
    INSERT INTO tweet
    (tweet, user_id)
    VALUES
    ("${tweet}",${user_id});
    `);

  response.send("Created a Tweet");
});

//API : 11;
//If the user deletes his tweet;
app.delete(
  "/tweets/:tweetId/",
  jwtTokenMiddleware,
  async (request, response) => {
    const { tweetId } = request.params;
    const userTweet = await db.get(`    
            SELECT
                tweet_id, user_id
            FROM 
                tweet 
            WHERE 
                tweet_id = ${tweetId} AND user_id = (SELECT user_id FROM user WHERE username = "${request.username}");
  `);

    if (userTweet === undefined) {
      response.status(401);
      response.send("Invalid Request");
    } else {
      await db.run(`
        DELETE FROM tweet
        WHERE tweet_id = ${tweetId}
        `);
      response.send("Tweet Removed");
    }
  }
);

module.exports = app;
