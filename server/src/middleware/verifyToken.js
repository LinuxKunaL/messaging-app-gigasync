import jwt from "jsonwebtoken";
import config from "../../config/config.js";
import { User } from "../../database/model.js";

const verifyToken = (req, res, next) => {
  if (!req.headers.authorization) return next();

  const token = req.headers.authorization.split(" ")[1];

  if (!req.headers.authorization) return res.status(401).send("Unauthorized");

  jwt.verify(token, config.jwt.key, (err, decoded) => {
    if (err) {
      if (err.message === "jwt expired") {
        const jwtToken = jwt.sign({ _id: decoded._id }, config.jwt.key, {
          expiresIn: config.jwt.expiresIn,
        });
        return res.status(200).send({ success: true, token: jwtToken });
      }
      return res.status(401).send("Unauthorized");
    }

    req.userId = decoded._id;

    User.findById(decoded._id)
      .then((user) => {
        if (!user) return res.status(401).send("Unauthorized");
        next();
      })
      .catch((Err) => {
        return res.status(500).send("Internal Server Error");
      });
  });
};

export default verifyToken;
