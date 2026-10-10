const pool =
  require("../db");

const deviceMiddleware =
  async (

    req,
    res,
    next

  ) => {

    try {

      const {

        device_id,
        device_secret

      } = req.body;

      const result =
        await pool.query(

          `SELECT *

          FROM devices

          WHERE device_id = $1

          AND device_secret = $2

          AND status = true`,

          [

            device_id,
            device_secret

          ]

        );

      if (
        result.rows.length === 0
      ) {

        return res.status(401).json({

          success: false,

          error:
            "Device tidak valid"

        });

      }

      req.device =
        result.rows[0];

      next();

    } catch (err) {

      console.log(err);

      res.status(500).json({

        success: false,

        error:
          "Device auth gagal"

      });

    }

};

module.exports =
  deviceMiddleware;
