/**
 * Admin geo handlers: Indian states and constituencies lookup.
 */
import type { NextFunction, Response } from "express";
import {
  getConstituenciesForState,
  getIndianStates,
} from "../services/india-geo.service.js";
import { BaseError, ValidationError } from "../utils/errors.js";

export async function getStates(req: any, res: Response, next: NextFunction) {
  try {
    const states = await getIndianStates();
    res.json({ states });
  } catch (err) {
    next(new BaseError("geo_unavailable", 503));
  }
}

export async function getConstituencies(
  req: any,
  res: Response,
  next: NextFunction,
) {
  const state =
    typeof req.query.state === "string" ? req.query.state.trim() : "";
  if (!state) {
    return next(new ValidationError("missing_state"));
  }
  try {
    const constituencies = await getConstituenciesForState(state);
    res.json({ state, constituencies });
  } catch (err) {
    next(new BaseError("geo_unavailable", 503));
  }
}
