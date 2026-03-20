import React from 'react'
import "../App.css"
import { Link, useNavigate } from 'react-router-dom'
export default function LandingPage() {


    const router = useNavigate();

    return (
        <div className='landingPageContainer'>
            <nav>
                <div className='navHeader'>
                    <h2>PulseMeet Video Call</h2>
                </div>
                <div className='navlist'>
                    <p onClick={() => {
                        router("/aljk23")
                    }}>Join as Guest</p>
                    <p onClick={() => {
                        router("/auth")

                    }}>Register</p>
                    <div onClick={() => {
                        router("/auth")

                    }} role='button'>
                        <p>Login</p>
                    </div>
                </div>
            </nav>


            <div className="landingMainContainer">
                <div>
                    <h1><span style={{ color: "#FF9839" }}>Connect</span> with your Mentors here</h1>

                    <p>Interact now by PulseMeet</p>
                    <div role='button'>
                        <Link to={"/auth"}>Get Started</Link>
                        {/* change dir for direction to other page */}
                    </div>
                </div>
                <div>

                    <img src="/public/mobile.png" alt="" />

                </div>
            </div>



        </div>
    )
}