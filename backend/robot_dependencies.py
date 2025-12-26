from fastapi import Depends, Header, HTTPException, status
from sqlmodel import Session, select

from .db import get_session
from .models import Robot


def get_current_robot(
    session: Session = Depends(get_session),
    x_robot_token: str | None = Header(default=None, alias="X-Robot-Token"),
):
    if not x_robot_token:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Robot token missing")
    robot = session.exec(select(Robot).where(Robot.api_token == x_robot_token)).first()
    if not robot:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid robot token")
    return robot
