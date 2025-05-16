const express = require("express");
const cors = require("cors");
require("dotenv").config();
const app = express();
const jwt = require("jsonwebtoken");
const stripe = require("stripe")(process.env.STRIPE_SECTET_KEY);
const port = process.env.PORT || 5000;
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");

app.use(
  cors({
    origin: ["http://localhost:5173"],
    credentials: true,
  })
);
app.use(express.json());

const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.llrud.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0`;
//   "mongodb+srv://<db_username>:<db_password>@cluster0.llrud.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0";

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

async function run() {
  try {
    // await client.connect();
    const userCollection = client.db("Tasks-DB").collection("users");
    const tasksCollection = client.db("Tasks-DB").collection("tasks");
    const paymentDataCollection = client
      .db("Tasks-DB")
      .collection("paymentData");
    const paymentCollection = client.db("Tasks-DB").collection("payments");
    const submissionCollection = client
      .db("Tasks-DB")
      .collection("submissions");
    const withdrawalsCollection = client
      .db("Tasks-DB")
      .collection("withdrawals");

    // jwt related api
    app.post("/jwt", async (req, res) => {
      const user = req.body;
      const token = jwt.sign(user, process.env.ACCESS_SECTET_KEY, {
        expiresIn: "1h",
      });
      res.send({ token });
    });

    // middlewares
    const verifyToken = (req, res, next) => {
      if (!req.headers.authorization) {
        return res.status(401).send({ message: "unauthorized access" });
      }
      const token = req.headers.authorization.split(" ")[1];
      jwt.verify(token, process.env.ACCESS_SECTET_KEY, (err, decoded) => {
        if (err) {
          return res.status(401).send({ message: "unauthorized access" });
        }
        req.decoded = decoded;
        next();
      });
    };

    // verify role for worker buyer admin
    const verifyRole = (role) => {
      return async (req, res, next) => {
        const email = req.decoded.email;
        const query = { email: email };
        const user = await userCollection.findOne(query);

        if (!role.includes(user.role)) {
          return res
            .status(403)
            .send({ message: "forbidden: you are not authorized" });
        }
        next();
      };
    };

    // genaral apis
    app.get("/top-workers", async (req, res) => {
      const topWorkers = await userCollection
        .find({ role: "Worker" })
        .sort({ coins: -1 })
        .limit(8)
        .toArray();

      res.send(topWorkers);
    });

    // user added in db
    app.post("/users/:email", async (req, res) => {
      const email = req.params.email;
      const user = req.body;

      const query = { email };
      const isExist = await userCollection.findOne(query);
      if (isExist)
        return res.send({ message: "user alredy exists", insertedId: null });

      const result = await userCollection.insertOne({
        ...user,
        timestamp: Date.now(),
      });
      res.send(result);
    });

    // get data in db for admin
    app.get("/users", verifyToken, verifyRole(["Admin"]), async (req, res) => {
      const result = await userCollection.find().toArray();
      res.send(result);
    });

    // user data get in db
    app.get("/users/:email", verifyToken, async (req, res) => {
      const email = req.params.email;
      if (email !== req.decoded.email)
        return res.status(404).send({ message: "user is not found" });

      const user = await userCollection.findOne({ email });
      if (!user) return res.status(404).send({ message: "user is not found" });

      res.send(user);
    });

    // user manage admin updated in db
    app.patch(
      "/users/:id",
      verifyToken,
      verifyRole(["Admin"]),
      async (req, res) => {
        const id = req.params.id;
        const filter = { _id: new ObjectId(id) };
        const { role } = req.body;
        const updatedDoc = {
          $set: { role: role },
        };
        const result = await userCollection.updateOne(filter, updatedDoc);
        res.send(result);
      }
    );

    // user admin manage delete in db
    app.delete(
      "/users/:id",
      verifyToken,
      verifyRole(["Admin"]),
      async (req, res) => {
        const id = req.params.id;
        const query = { _id: new ObjectId(id) };
        const result = await userCollection.deleteOne(query);
        console.log("delete hoiche", result);

        res.send(result);
      }
    );

    // tasks added in db buyer
    app.post("/tasks", verifyToken, verifyRole(["Buyer"]), async (req, res) => {
      const task = req.body;
      const result = await tasksCollection.insertOne(task);
      res.send(result);
    });

    // tasks api get in db
    app.get("/tasks", async (req, res) => {
      const { email } = req.query;
      if (email) {
        const tasks = await tasksCollection
          .find({ buyer_email: email })
          .sort({ completion_date: -1 })
          .toArray();
        res.send(tasks);
      } else {
        const tasks = await tasksCollection
          .find({ required_workers: { $gt: 0 } })
          .sort({ completion_date: -1 })
          .toArray();
        res.send(tasks);
      }
    });

    // tasks get id in db
    app.get("/tasks/:id", async (req, res) => {
      const { id } = req.params;

      const task = await tasksCollection.findOne({ _id: new ObjectId(id) });
      res.send(task);
    });

    // tasks updated in db
    app.patch(
      "/tasks/:id",
      verifyToken,
      verifyRole(["Buyer", "Admin"]),
      async (req, res) => {
        const { id } = req.params;
        const { task_title, task_detail, submission_info } = req.body;
        const query = { _id: new ObjectId(id) };
        const updatedDoc = {
          $set: {
            task_title: task_title,
            task_detail: task_detail,
            submission_info: submission_info,
          },
        };
        const result = await tasksCollection.updateOne(query, updatedDoc);
        res.send(result);
      }
    );

    // delete tasks in db
    app.delete(
      "/tasks/:id",
      verifyToken,
      verifyRole(["Buyer", "Admin"]),
      async (req, res) => {
        const { id } = req.params;

        const result = await tasksCollection.deleteOne({
          _id: new ObjectId(id),
        });

        res.send(result);
      }
    );

    // update refund coins
    app.patch(
      "/refund-coins",
      verifyToken,
      verifyRole(["Buyer", "Admin"]),
      async (req, res) => {
        const { taskId, amount } = req.body;
        const tasks = await tasksCollection.findOne({
          _id: new ObjectId(taskId),
        });

        if (!tasks) return res.status(404).send({ error: "tasks not found" });
        const buyerEmail = tasks.buyer_email;
        const result = await userCollection.updateOne(
          { email: buyerEmail },
          { $set: { coins: amount } }
        );
        res.send(result);
      }
    );

    // update deduct coins in dv
    app.patch(
      "/deduct-coins",
      verifyToken,
      verifyRole(["Buyer"]),
      async (req, res) => {
        const { totalPayableAmount } = req.body;
        const user = await userCollection.findOne({ email: req.decoded.email });

        if (user.coins < totalPayableAmount)
          return res
            .status(400)
            .send({ error: "not enough coins. please purchese now," });

        const result = await userCollection.updateOne(
          { email: req.decoded.email },
          { $inc: { coins: -totalPayableAmount } }
        );
        res.send(result);
      }
    );

    // submition added in db
    app.post("/submissions", verifyToken, async (req, res) => {
      const submissionData = req.body;
      const result = await submissionCollection.insertOne(submissionData);
      res.send(result);
    });

    // my submission get in db
    app.get("/my-submissions", verifyToken, async (req, res) => {
      const workerEmail = req.decoded.email;
      const submissions = await submissionCollection
        .find({ worker_email: workerEmail })
        .toArray();
      res.send(submissions);
    });

    // pending submissions get in db
    app.get(
      "/pending-submissions",
      verifyToken,
      verifyRole(["Buyer"]),
      async (req, res) => {
        const email = req.decoded.email;
        const submission = await submissionCollection
          .find({ buyer_email: email, status: "pending" })
          .toArray();
        res.send(submission);
      }
    );

    // get approved submissions im db
    app.get("/approved-submissions", verifyToken, async (req, res) => {
      const workerEmail = req.decoded.email;
      const submissions = await submissionCollection
        .find({ worker_email: workerEmail, status: "approved" })
        .toArray();
      res.send(submissions);
    });

    // approve submission updated in db
    app.patch(
      "/approve-submission/:id",
      verifyToken,
      verifyRole(["Buyer"]),
      async (req, res) => {
        const id = req.params.id;
        const result = await submissionCollection.updateOne(
          { _id: new ObjectId(id) },
          { $set: { status: "approved" } }
        );
        if (result.modifiedCount > 0) {
          const submission = await submissionCollection.findOne({
            _id: new ObjectId(id),
          });
          await userCollection.updateOne(
            { email: submission.worker_email },
            { $inc: { coins: submission.task_amount } }
          );
        }
        res.send(result);
      }
    );

    // reject submission
    app.patch(
      "/reject-submission/:id",
      verifyToken,
      verifyRole(["Buyer"]),
      async (req, res) => {
        const id = req.params.id;
        const { tasksId } = req.body;
        const result = await submissionCollection.updateOne(
          { _id: new ObjectId(id) },
          { $set: { status: "rejected" } }
        );

        if (result.modifiedCount > 0) {
          await tasksCollection.updateOne(
            { _id: new ObjectId(tasksId) },
            { $inc: { required_workers: 1 } }
          );
        }
        res.send(result);
      }
    );

    // admin status get in db
    app.get(
      "/admin-status",
      verifyToken,
      verifyRole(["Buyer", "Admin"]),
      async (req, res) => {
        const totalWorkers = await userCollection.countDocuments({
          role: "Worker",
        });
        const totalBuyers = await userCollection.countDocuments({
          role: "Buyer",
        });
        const totalAvailableCoins = await userCollection
          .aggregate([
            { $group: { _id: null, totalCoins: { $sum: "$coins" } } },
          ])
          .toArray();

        const totalPaymentsData = await paymentCollection
          .aggregate([
            {
              $group: {
                _id: null,
                totalPayments: { $sum: "$withdraal_amount" },
              },
            },
          ])
          .toArray();

        const totalPayments =
          totalPaymentsData.length > 0 ? totalPaymentsData[0].totalPayments : 0;

        res.send({
          totalWorkers,
          totalBuyers,
          totalAvailableCoins: totalAvailableCoins[0]?.totalCoins || 0,
          totalPayments,
        });
      }
    );

    // worker status get in db
    app.get("/worker-status", verifyToken, async (req, res) => {
      const workerEmail = req.decoded.email;
      const totalSubmissions = await submissionCollection.countDocuments({
        worker_email: workerEmail,
      });

      const totalPendingSubmissions = await submissionCollection.countDocuments(
        { worker_email: workerEmail, status: "pending" }
      );

      const totalEarningData = await paymentCollection
        .aggregate([
          { $match: { email: workerEmail } },
          {
            $group: {
              _id: null,
              totalEarnings: { $sum: "$withdrawal_amount" },
            },
          },
        ])
        .toArray();

      const totalEarnings =
        totalEarningData.length > 0 ? totalEarningData[0].totalEarnings : 0;
      res.send({
        totalSubmissions,
        totalPendingSubmissions,
        totalEarnings,
      });
    });

    // buyer status
    app.get(
      "/buyer-status",
      verifyToken,
      verifyRole(["Buyer"]),
      async (req, res) => {
        const buyerEmail = req.decoded.email;

        const totalTasks = await tasksCollection.countDocuments({
          buyer_email: buyerEmail,
        });

        const pendingTasksData = await tasksCollection
          .aggregate([
            { $match: { buyer_email: buyerEmail } },
            {
              $group: {
                _id: null,
                totalPending: { $sum: "$required_workers" },
              },
            },
          ])
          .toArray();
        const pendingTasks = pendingTasksData[0]?.totalPending || 0;

        const totalPaymentsToBuyCoin = await paymentDataCollection
          .aggregate([
            { $match: { email: buyerEmail } },
            { $group: { _id: null, totalPayments: { $sum: "$price" } } },
          ])
          .toArray();

        const totalPayments =
          totalPaymentsToBuyCoin.length > 0
            ? totalPaymentsToBuyCoin[0].totalPayments
            : 0;
        res.send({ totalTasks, pendingTasks, totalPayments });
      }
    );

    // withdrawals get in db
    app.get(
      "/withdrawals",
      verifyToken,
      verifyRole(["Admin"]),
      async (req, res) => {
        const { status } = req.query;
        const withdrawals = await withdrawalsCollection
          .find({
            status: status,
          })
          .toArray();
        res.send(withdrawals);
      }
    );

    //withdrawals in db
    app.post(
      "/withdrawals",
      verifyToken,
      verifyRole(["Worker"]),
      async (req, res) => {
        const withdrawalData = req.body;
        if (
          !withdrawalData.worker_email ||
          withdrawalData.wwithdrawal_coin < 200
        )
          return res
            .status(400)
            .send({ message: "Incalid withdrawal request!" });

        const result = await withdrawalsCollection.insertOne(withdrawalData);
        res.send(result);
      }
    );

    // withdrawals update in db
    app.patch(
      "/withdrawals/:id/approve",
      verifyToken,
      verifyRole(["Admin"]),
      async (req, res) => {
        const { id } = req.params;
        const withdrawal = await withdrawalsCollection.findOne({
          _id: new ObjectId(id),
        });
        if (!withdrawal)
          return res
            .status(404)
            .send({ message: "Withdrawal request not found." });

        const coinToDeduct = Number(withdrawal.withdrawal_coins);

        if (isNaN(coinToDeduct)) {
          return res.status(400).send({ message: "Invalid coin amount." });
        }

        const updateUserCoins = await userCollection.updateOne(
          { email: withdrawal.worker_email },
          {
            $inc: { coins: -coinToDeduct },
          }
        );

        // Update the withdrawal request status
        if (updateUserCoins.modifiedCount > 0) {
          await withdrawalsCollection.updateOne(
            { _id: new ObjectId(id) },
            { $set: { status: "approved" } }
          );
        }

        // Add payment information to paymentCollection
        const paymentInfo = {
          name: withdrawal.worker_name,
          role: "Worker",
          email: withdrawal.worker_email,
          withdrawal_amount: withdrawal.withdrawal_amount,
          payment_system: withdrawal.payment_system,
          withdraw_date: withdrawal.withdraw_date,
          approved_date: new Date(),
        };
        const paymentResult = await paymentCollection.insertOne(paymentInfo);

        res.send({
          message: "Withdrawal approved and payment information recorded",
          updateUserCoins,
          paymentResult,
        });
      }
    );

    // payment get api in db
    app.get("/payments/:email", verifyToken, async (req, res) => {
      const query = { email: req.params.email };
      if (req.params.email !== req.decoded.email)
        return res.status(403).send({ message: "fotbidden access" });

      const payments = await paymentDataCollection.find(query).toArray();
      res.send(payments);
    });

    // payment intent
    app.post("/create-payment-intent", async (req, res) => {
      const { amount } = req.body;
      try {
        const paymentIntent = await stripe.paymentIntents.create({
          amount,
          currency: "usd",
          payment_method_types: ["card"],
        });
        res.send({ clientSecret: paymentIntent.client_secret });
      } catch (error) {
        res.status(500).send({ message: error.message });
      }
    });

    // user coins payments
    app.post("/payments", async (req, res) => {
      const paymentData = req.body;
      try {
        const user = await userCollection.findOne({ email: paymentData.email });
        if (!user) return res.status(404).send({ message: "user not found!" });

        // added payment info to payment collection
        const paymentResult = await paymentDataCollection.insertOne(
          paymentData
        );

        // update byuer coins
        const updatedResult = await userCollection.updateOne(
          { email: paymentData.email },
          { $inc: { coins: paymentData.coins } }
        );

        if (updatedResult.modifiedCount === 0)
          return res
            .status(500)
            .send({ message: "failed to update user coins" });

        res.send({
          message: "payment successfully & coins added",
          paymentResult,
        });
      } catch (error) {
        res.status(500).send({ message: error.message });
      }
    });
  } finally {
    // await client.close();
  }
}
run().catch(console.dir);

app.get("/", (req, res) => res.send("Server is Running"));
app.listen(port, () => console.log(`Server Running on port ${port}`));
