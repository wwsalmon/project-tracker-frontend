import React, {useState, useRef} from "react";
import {Link} from "react-router-dom";
import {API, graphqlOperation, Storage} from "aws-amplify";
import {format} from 'date-fns';
import utf8 from "utf8";

import SimpleMDE from "react-simplemde-editor";
import "easymde/dist/easymde.min.css";

import * as Showdown from "showdown";
import Parser from 'html-react-parser';

import * as FilePond from 'react-filepond';
import FilePondPluginImagePreview from "filepond-plugin-image-preview";
import FilePondPluginFileValidateSize from "filepond-plugin-file-validate-size";
import FilePondPluginFileValidateType from "filepond-plugin-file-validate-type";
import "filepond/dist/filepond.min.css";
import 'filepond-plugin-image-preview/dist/filepond-plugin-image-preview.css';

import {v1 as uuidv1} from 'uuid';

import EventImage from "../components/EventImage";

import {FontAwesomeIcon} from '@fortawesome/react-fontawesome'
import {faGlobe, faTimes} from "@fortawesome/free-solid-svg-icons";

import MoreButton from "../components/MoreButton";
import {changeAcl} from "../lib/aclLib";

import {useAuth} from "../lib/authLib";

import Modal from "./Modal";

import MoveEvent from "./MoveEvent";


import {deleteEvent} from "../lib/reqLib";

export default function ProjectItem(props) {
    const [event, setEvent] = useState(props.event);
    const [decodedNote, setDecodedNote] = useState(utf8.decode(props.event.note));
    const [isPrivate, setIsPrivate] = useState(event.hidden);
    const [publicId, setPublicId] = useState((event.publicEvent === null || event.publicEvent === undefined) ? false : event.publicEvent.id);

    // new note states
    const [isEdit, setIsEdit] = useState(false);
    const [canSave, setCanSave] = useState(true);
    const [newNote, setNewNote] = useState(decodedNote);
    const [newFiles, setNewFiles] = useState([]);
    const [fileUUIDs, setFileUUIDs] = useState([]);
    let fasterFileUUIDs = [];

    // prop functions
    const removeLocal = props.removeLocal; // for deleting update
    const changeHiddenLocal = props.changeHiddenLocal; // for changing public status

    const pond = useRef();
    const modal = useRef();
    const auth = useAuth();

    FilePond.registerPlugin(FilePondPluginImagePreview,
        FilePondPluginFileValidateSize,
        FilePondPluginFileValidateType);

    function handleFilePondUpdate(fileItems) {
        setNewFiles(fileItems.map(fileItem => fileItem.file));
    }

    async function handleToggleHidden(e) {
        e.preventDefault();

        /*

        private -> public:
        update private event and get public project id
        create new public event with all info of private event
        update private event to link to public event

        public -> private:
        update private event and get link to public event
        delete public event

        */

        try {
            if (props.publicId === false) {
                throw new Error("Project not public");
            }
            if (isPrivate) { // private -> public
                const newFileUUIDs = `[${event.filenames.map(d => `"${d}"`)}]`;
                const updateEventQ1 = `
                    mutation{
                        updateEvent(input: {id: "${event.id}", hidden: true}){
                            hidden project { publicProject{ id } }
                        }
                    }
                `;
                const update1Data = await API.graphql(graphqlOperation(updateEventQ1));
                const publicProjectId = update1Data.data.updateEvent.project.publicProject.id;
                // if (publicProjectId === undefined) throw "Project is not public, failed to make update public";
                const createPublicEventQ = `
                    mutation create($newNote: String){
                        createPublicEvent(input: {filenames: ${newFileUUIDs},
                        note: $newNote,
                        time: "${event.time}",
                        publicEventPublicProjectId: "${publicProjectId}"}){ id filenames note time publicProject { id }}
                    }    
                `
                const createPublicData = await API.graphql(graphqlOperation(createPublicEventQ, {newNote: utf8.encode(newNote)}));
                const publicEventId = createPublicData.data.createPublicEvent.id;
                const updateEventQ2 = `
                    mutation{
                        updateEvent(input: {id: "${event.id}", eventPublicEventId: "${publicEventId}", hidden: false}){
                            id hidden filenames note time publicEvent { id } project { id publicProject { id } }
                        }
                    }
                `
                const update2Data = await API.graphql(graphqlOperation(updateEventQ2));

                for (const filename of event.filenames) {
                    await changeAcl(filename, auth, "public");
                }

                setEvent(update2Data.data.updateEvent);
                setPublicId(publicEventId);
            } else { // public -> private
                const updateEventQ = `
                    mutation{
                        updateEvent(input: {id: "${event.id}", hidden: true}){
                            id hidden filenames note time publicEvent { id } project { id publicProject { id } }
                        }
                    }                    
                `
                const updateData = await API.graphql(graphqlOperation(updateEventQ));
                const publicEventData = updateData.data.updateEvent.publicEvent;
                if (publicEventData === null) {
                    console.warn("No public event found for this event.");
                } else {
                    const publicEventId = publicEventData.id;
                    const deletePublicEventQ = `
                    mutation{
                        deletePublicEvent(input: {id: "${publicEventId}"}){ id }
                    }
                `
                    await API.graphql(graphqlOperation(deletePublicEventQ));
                    setPublicId(false);
                }

                for (const filename of event.filenames) {
                    changeAcl(filename, auth, "private");
                }

                setEvent(updateData.data.updateEvent);
            }
            setIsPrivate(!isPrivate);
            changeHiddenLocal(event.id, !isPrivate);
        } catch (e) {
            console.log(e);
        }
    }

    function handleToggleEdit(e) {
        e.preventDefault();
        setIsEdit(true);
    }

    function deleteAttachment(filename) {
        const newFilenames = event.filenames.filter(x => x !== filename);
        const newFileUUIDs = `[${newFilenames.map(d => `"${d}",`)}]`;
        const query = `
        mutation{
            updateEvent(
                input: {
                    id: "${event.id}",
                    filenames : ${newFileUUIDs}  
                }
                    )
            { id filenames note hidden time publicEvent {id}}
        }`

        API.graphql(graphqlOperation(query)).then(res => {
            setEvent(res.data.updateEvent);
            try {
                Storage.vault.remove(filename);
            } catch (e) {
                console.log(e);
            }
        }).catch(e => console.log(e));

    }

    async function handleEditEvent(e) {
        e.preventDefault();
        const allFileUUIDs = [...event.filenames, ...fileUUIDs];
        const newFileUUIDs = `[${allFileUUIDs.map(d => `"${d}"`)}]`;
        const newNoteEncoded = utf8.encode(newNote);
        let query = `
        mutation update($newNote: String){
            updateEvent(input: {
                id: "${event.id}",
                note: $newNote,
                filenames: ${newFileUUIDs}
            }){id hidden filenames note time publicEvent { id } project { id publicProject { id } }}`
        query += publicId ? `updatePublicEvent(input:{
            id: "${publicId}",
            note: $newNote,    
            filenames: ${newFileUUIDs}
        }){ id }` : "";
        query += "}";
        API.graphql(graphqlOperation(query, {newNote: newNoteEncoded})).then(res => {
            setEvent(res.data.updateEvent);
            setDecodedNote(newNote);
            setNewFiles([]);
            setFileUUIDs([]);
            setIsEdit(false);
        }).catch(e => console.log(e));
    }

    async function handleCancelEdit(e) {
        e.preventDefault();
        if (newNote !== decodedNote || newFiles.length !== 0) {
            if (window.confirm("You have unsaved changes. Are you sure you want to discard them?")) {
                setNewNote(decodedNote);
                const filenamesToDelete = fileUUIDs.filter(x => event.filenames.indexOf(x) < 0);
                for (const filename of filenamesToDelete) {
                    await Storage.vault.remove(filename);
                }
                setNewFiles([]);
                setFileUUIDs([]);
                setIsEdit(false);
            }
        } else {
            setIsEdit(false);
        }
    }

    const markdownConverter = new Showdown.Converter({
        tables: true,
        simplifiedAutoLink: true,
        strikethrough: true,
        tasklists: true
    });

    return (
        <div className={isPrivate ? "projectItemPrivate" : ""}>
            <hr></hr>
            <div
                className={`md:flex py-8 ${isPrivate ? "md:hover:bg-gray-100" : "md:hover:bg-blue-100"} rounded relative`}>
                <div className="w-32 flex-none flex md:block mb-4 md:mb-0">
                    <p className="supra">{
                        format(new Date(event.time), "h:mm a")
                    }</p>
                    {!isPrivate && (
                        <Link to={`/public/${props.publicId}/${event.publicEvent.id}`} target="_blank">
                            <FontAwesomeIcon className="text-blue-400 ml-2 md:ml-0 md:my-4" icon={faGlobe}/>
                        </Link>
                    )}
                </div>
                <div className="content md:pr-8 mr-6 md:mr-0 md:w-8" style={{flex: "1 0 0"}}>
                    {/* w-8 is arbitrary here to get flex to work*/}
                    {isEdit ? (
                        <>
                            <SimpleMDE
                                value={newNote}
                                onChange={setNewNote}
                                options={{
                                    spellChecker: false,
                                    // uploadImage: true,
                                    // imageUploadFunction: handleMDEImageUpload
                                }}
                            />
                            <p className="label my-2">Attach new images to update</p>
                            <FilePond.FilePond server={
                                {
                                    process: (fieldName, file, metadata, load, error, progress, abort, removeLocal, transfer, options) => {
                                        const extArray = file.name.split('.');
                                        const ext = extArray[extArray.length - 1];
                                        const uuid = uuidv1() + `.${ext}`;

                                        Storage.vault.put(uuid, file, {
                                            progressCallback(thisProgress) {
                                                progress(thisProgress.lengthComputable, thisProgress.loaded, thisProgress.total);
                                            }
                                        }).then(res => {
                                            load(res.key);
                                            setCanSave(true);
                                            fasterFileUUIDs.push(uuid);
                                            setFileUUIDs([...fileUUIDs, ...fasterFileUUIDs]);
                                        }).catch(e => {
                                            console.log(e);
                                            error(e);
                                            setCanSave(true);
                                        });

                                        return {
                                            abort: () => {
                                                abort();
                                                setCanSave(true);
                                            }
                                        }
                                    },
                                    revert: (uniqueFileId, load, error) => {
                                        try {
                                            Storage.vault.remove(uniqueFileId)
                                                .then(() => {
                                                    fasterFileUUIDs.filter(d => d !== uniqueFileId);
                                                    fileUUIDs.filter(d => d !== uniqueFileId);
                                                    setFileUUIDs([...fileUUIDs, ...fasterFileUUIDs]);
                                                    load();
                                                });
                                        } catch (e) {
                                            error(e);
                                        }
                                    }
                                }
                            }
                                               ref={pond}
                                               files={newFiles}
                                               allowMultiple={true}
                                               onupdatefiles={(fileItems) => handleFilePondUpdate(fileItems)}
                                               maxFileSize="1MB"
                                               acceptedFileTypes={["image/png", "image/jpeg", "image/jpg", "image/gif"]}
                            />
                            <div className="flex">
                                <button onClick={handleEditEvent}
                                        disabled={(newNote === decodedNote && newFiles.length === 0) || !canSave}
                                        className="button field w-auto block my-4 mr-2">Save Changes
                                </button>
                                <button onClick={handleCancelEdit}
                                        className="button field ~warning !low w-auto block my-4 mr-2">Cancel Edit
                                </button>
                            </div>
                        </>
                    ) : Parser(markdownConverter.makeHtml(decodedNote))}
                    <div className="overflow-x-auto mt-8 pt-8">
                        <div className="flex pb-4">
                            {event.filenames.map(filename => (
                                <div key={filename}>
                                    {isEdit && (
                                        <button className="button ~critical !low"
                                                onClick={() => deleteAttachment(filename)}><FontAwesomeIcon
                                            icon={faTimes}/>
                                        </button>
                                    )}
                                    <EventImage s3key={filename} key={filename}/>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>


                {/* <button className="ml-auto button self-start absolute right-0 top-8 md:static" id={event.id + "-showMoreButton"} ref={showMoreButton} onClick={() => setShowOptions(!showOptions)}><FontAwesomeIcon icon={faEllipsisV}></FontAwesomeIcon></button>
                {showOptions && (
                    <div className="flex absolute flex-col bg-white right-0 rounded top-8 mt-8 py-2 border z-10">
                        <button className="hover:bg-gray-100 py-2 px-4 text-left" onClick={handleDeleteEvent}>Delete</button>
                        {!isEdit && <button className="hover:bg-gray-100 py-2 px-4 text-left" onClick={handleToggleEdit}>Edit</button>}
                        <button className="hover:bg-gray-100 py-2 px-4 text-left" onClick={handleToggleHidden}>
                            {isPrivate ? "Make public" : "Make private"}
                        </button>
                    </div>
                )} */}

                <MoreButton className="right-0 top-8" uid={event.id}>
                    {!isEdit &&
                    <button className="hover:bg-gray-100 py-2 px-4 text-left" onClick={handleToggleEdit}>Edit</button>}
                    <button disabled={!props.publicId}
                            className="button hover:bg-gray-100 py-2 px-4 text-left"
                            onClick={handleToggleHidden}
                    >
                        {isPrivate ? "Make public" : "Make private"}
                    </button>
                    <Modal buttonClassName="button hover:bg-gray-100 py-2 px-4 text-left"
                           buttonDisabled={!event.hidden}
                            buttonText="Move to another project"
                            ref={modal}>
                        <MoveEvent event={event} modal={modal} removeLocal={removeLocal}/>
                    </Modal>
                    <button className="hover:bg-gray-100 py-2 px-4 text-left"
                            onClick={() => {deleteEvent(event, () => {removeLocal(event.id)});}}>
                        Delete
                    </button>
                </MoreButton>
            </div>
        </div>
    )
}