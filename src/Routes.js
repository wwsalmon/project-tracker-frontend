import React from "react";
import { Route, Switch } from "react-router-dom";

import Home from "./containers/Home";
import Login from "./containers/Login";
import SignUp from "./containers/SignUp";
import NewProject from "./containers/NewProject";
import Project from "./containers/Project";
import Projects from "./containers/Projects";
import PublicProject from "./containers/PublicProject";

export default function Routes() {
    return (
        <Switch>
            <Route exact path="/">
                <Home />
            </Route>
            <Route exact path="/login">
                <Login />
            </Route>
            <Route exact path="/signup">
                <SignUp />
            </Route>
            <Route exact path="/projects" render={(props) => <Projects {...props} />}/>
            <Route exact path="/projects/new">
                <NewProject />
            </Route>
            <Route exact path="/projects/:id">
                <Project />
            </Route>
            <Route exact path="/public/:id">
                <PublicProject />
            </Route>
        </Switch>
    );
}