import { IDisplayObjectAdapter, MovieClip as AwayMovieClip, Sprite as AwaySprite, DisplayObject as AwayDisplayObject, IMovieClipAdapter, SceneGraphPartition, Timeline, FrameScriptManager } from "@awayjs/scene";
import { Sprite } from "./Sprite";
import { Matrix3D } from '@awayjs/core';
import { constructClassFromSymbol } from '../../avm2/constructClassFromSymbol';

var includeString: string = '';//TODO

declare var __framescript__;
/**
 * The MovieClip class inherits from the following classes: Sprite, DisplayObjectContainer,
 * InteractiveObject, DisplayObject, and EventDispatcher.
 *
 *   <p class="- topic/p ">Unlike the Sprite object, a MovieClip object has a timeline.</p><p class="- topic/p ">&gt;In Flash Professional, the methods for the MovieClip class provide the same functionality
 * as actions that target movie clips. Some additional methods do not have equivalent
 * actions in the Actions toolbox in the Actions panel in the Flash authoring tool. </p><p class="- topic/p ">Children instances placed on the Stage in Flash Professional cannot be accessed by code from within the
 * constructor of a parent instance since they have not been created at that ponumber in code execution.
 * Before accessing the child, the parent must instead either create the child instance
 * by code or delay access to a callback that listens for the child to dispatch
 * its <codeph class="+ topic/ph pr-d/codeph ">Event.ADDED_TO_STAGE</codeph> event.</p><p class="- topic/p ">If you modify any of the following properties of a MovieClip object that contains a motion tween,
 * the playhead is stopped in that MovieClip object: <codeph class="+ topic/ph pr-d/codeph ">alpha</codeph>, <codeph class="+ topic/ph pr-d/codeph ">blendMode</codeph>,
 * <codeph class="+ topic/ph pr-d/codeph ">filters</codeph>, <codeph class="+ topic/ph pr-d/codeph ">height</codeph>, <codeph class="+ topic/ph pr-d/codeph ">opaqueBackground</codeph>, <codeph class="+ topic/ph pr-d/codeph ">rotation</codeph>,
 * <codeph class="+ topic/ph pr-d/codeph ">scaleX</codeph>, <codeph class="+ topic/ph pr-d/codeph ">scaleY</codeph>, <codeph class="+ topic/ph pr-d/codeph ">scale9Grid</codeph>, <codeph class="+ topic/ph pr-d/codeph ">scrollRect</codeph>,
 * <codeph class="+ topic/ph pr-d/codeph ">transform</codeph>, <codeph class="+ topic/ph pr-d/codeph ">visible</codeph>, <codeph class="+ topic/ph pr-d/codeph ">width</codeph>, <codeph class="+ topic/ph pr-d/codeph ">x</codeph>,
 * or <codeph class="+ topic/ph pr-d/codeph ">y</codeph>. However, it does not stop the playhead in any child MovieClip objects of that
 * MovieClip object.</p><p class="- topic/p "><b class="+ topic/ph hi-d/b ">Note:</b>Flash Lite 4 supports the MovieClip.opaqueBackground property only if
 * FEATURE_BITMAPCACHE is defined. The default configuration of Flash Lite 4 does not define
 * FEATURE_BITMAPCACHE. To enable the MovieClip.opaqueBackground property for a suitable device,
 * define FEATURE_BITMAPCACHE in your project.</p>*/
export class MovieClip extends Sprite implements IMovieClipAdapter {
	private static _movieClips: Array<MovieClip> = new Array<MovieClip>();

	private _tmpScripts:any;
	public applySymbol() {}
	public static getNewMovieClip(adaptee: AwayMovieClip): MovieClip {
		if (MovieClip._movieClips.length) {
			var movieClip: MovieClip = MovieClip._movieClips.pop();
			movieClip.adaptee = adaptee;
			return movieClip;
		}

		return new MovieClip(adaptee);
	}


	//forAVM1:
	public _getAbsFrameNumber(param1: any, param2: any): number {
		return 0;
	}
	public callFrame(param1: any) {
	}
	public _callFrame(param1: any) {
	}
	public addScript(param1: any) {
		return param1;
	}

	public executeScript(scripts: any) {
		if (scripts){
			for (let k = 0; k < scripts.length; k++) {
				scripts[k].setReceiver(this);
				scripts[k].axCall(this);
			}
		}
	}

	/**
	 * Creates a new MovieClip instance. After creating the MovieClip, call the
	 * addChild() or addChildAt() method of a
	 * display object container that is onstage.
	 */
	constructor(adaptee: AwayMovieClip = null) {
		if(!adaptee && AwayMovieClip.mcForConstructor){
			adaptee=AwayMovieClip.mcForConstructor;
			AwayMovieClip.mcForConstructor=null;
		}
		super(adaptee || AwayMovieClip.getNewMovieClip());	
		this.adaptee.reset();
		this._tmpScripts={};
	}

	// --------------------- stuff needed because of implementing the existing IMovieClipAdapter

	public evalScript(str: string): Function {
		var tag: HTMLScriptElement = document.createElement('script');
		tag.text = 'var __framescript__ = function() {\n' + includeString + str + '\n}';

		//add and remove script tag to dom to trigger compilation
		var sibling = document.scripts[0];
		sibling.parentNode.insertBefore(tag, sibling).parentNode.removeChild(tag);

		var script = __framescript__;
		window['__framescript__'] = null;

		return script;
	}

	public freeFromScript(): void {
		//this.stopAllSounds();
		super.freeFromScript();

	}
	public clone(): MovieClip {
		if(!(<any>this)._symbol){
			throw("_symbol not defined when cloning movieclip")
		}
		//var clone: MovieClip = MovieClip.getNewMovieClip(AwayMovieClip.getNewMovieClip((<AwayMovieClip>this.adaptee).timeline));
		var clone=constructClassFromSymbol((<any>this)._symbol, (<any>this)._symbol.symbolClass);
		//console.log("clone", (<any>this)._symbol, (<any>this)._symbol.symbolClass);
		var adaptee=new AwayMovieClip((<AwayMovieClip>this.adaptee).timeline);
		this.adaptee.copyTo(adaptee);

		
		if(Timeline.currentInstanceName){
			adaptee.name=Timeline.currentInstanceName;
			Timeline.currentInstanceName=null;
		};
		
		if(Timeline.currentInstanceMatrix){
		
			var new_matrix:Matrix3D = adaptee.transform.matrix3D;
			new_matrix._rawData[0] = Timeline.currentInstanceMatrix.a;
			new_matrix._rawData[1] =  Timeline.currentInstanceMatrix.b;
			new_matrix._rawData[4] =  Timeline.currentInstanceMatrix.c;
			new_matrix._rawData[5] =  Timeline.currentInstanceMatrix.d;
			new_matrix._rawData[12] =  Timeline.currentInstanceMatrix.tx/20;
			new_matrix._rawData[13] =  Timeline.currentInstanceMatrix.ty/20;

			adaptee.transform.invalidateComponents();
			Timeline.currentInstanceMatrix=null;
		}
		
		AwayMovieClip.mcForConstructor=adaptee;
		clone.axInitializer();

		// if this is a custom class (not a plain MC or Sprite)
		// make sure that the clone will not be reused on the timeline.
		// it must reclone for every new instance thats added to scene, so that the as3 constructor (axInitializer) will run again...
		// (if cloneForEveryInstance is true, the awayjs-mc will not cache the instance on the potentialinstance-list)
		if((<any>this)._symbol.className){
			clone.adaptee.cloneForEveryInstance=true;
		}
		if(clone.adaptee.timeline){
			clone.adaptee.timeline.add_script_for_postcontruct(clone.adaptee, 0, true );
			
			// 	hack to BadIceCreamFont compiledClip:
			//	the compiledClip "BadIcecreamFont" seem to behave different to other classes
			//	it seem to always stick to frame 0, 
			if((<any>this)._symbol.className && (<any>this)._symbol.className=="BadIcecreamFont"){
				clone.adaptee.cloneForEveryInstance=false; // for this special case, we do not want to reclone it on reset
				clone.adaptee.noTimelineUpdate=true;
				clone.adaptee.timeline.frame_command_indices=[clone.adaptee.timeline.frame_command_indices[0]];
				clone.adaptee.timeline.frame_recipe=[clone.adaptee.timeline.frame_recipe[0]];
				clone.adaptee.timeline.keyframe_constructframes=[clone.adaptee.timeline.keyframe_constructframes[0]];
				clone.adaptee.timeline.keyframe_durations=[clone.adaptee.timeline.keyframe_durations[0]];
				clone.adaptee.timeline.keyframe_firstframes=[clone.adaptee.timeline.keyframe_firstframes[0]];
				clone.adaptee.timeline.keyframe_indices=[clone.adaptee.timeline.keyframe_indices[0]];	
			}
		}
		// 	in awayjs, mcs do reset after adding them as child
		//	for as3 mcs we prevent this by setting noReset to true
		(<any>clone).noReset=true;
		return clone;
	}

	/**
	 * @inheritDoc
	 */
	public dispose(): void {
		this.disposeValues();

		//MovieClip._movieClips.push(this);
	}

	//---------------------------original as3 properties / methods:

	/**
	 * Specifies the number of the frame in which the playhead is located in the timeline of
	 * the MovieClip instance. If the movie clip has multiple scenes, this value is the
	 * frame number in the current scene.
	 */
	public get currentFrame(): number {
		return (<AwayMovieClip>this._adaptee).currentFrameIndex + 1;
	}

	/**
	 * The label at the current frame in the timeline of the MovieClip instance.
	 * If the current frame has no label, currentLabel is null.
	 */
	public get currentFrameLabel(): string {
		return (<AwayMovieClip>this.adaptee).timeline.getCurrentFrameLabel(<AwayMovieClip>this.adaptee);
	}

	/**
	 * The current label in which the playhead is located in the timeline of the MovieClip instance.
	 * If the current frame has no label, currentLabel is set to the name of the previous frame
	 * that includes a label. If the current frame and previous frames do not include a label,
	 * currentLabel returns null.
	 */
	public get currentLabel(): string {
		return (<AwayMovieClip>this.adaptee).timeline.getCurrentLabel(<AwayMovieClip>this.adaptee);
	}

	/**
	 * Returns an array of FrameLabel objects from the current scene. If the MovieClip instance does
	 * not use scenes, the array includes all frame labels from the entire MovieClip instance.
	 */
	public get currentLabels(): any[] {
		//todo
		console.log("currentFrameLabel not implemented yet in flash/MovieClip");
		return [];
	}

	/**
	 * The current scene in which the playhead is located in the timeline of the MovieClip instance.
	 */
	public get currentScene(): any {
		//todo
		console.log("currentScene not implemented yet in flash/MovieClip");
		return null;
	}

	/**
	 * A boolean value that indicates whether a movie clip is enabled. The default value of enabled
	 * is true. If enabled is set to false, the movie clip's
	 * Over, Down, and Up frames are disabled. The movie clip
	 * continues to receive events (for example, mouseDown,
	 * mouseUp, keyDown, and keyUp).
	 *
	 *   The enabled property governs only the button-like properties of a movie clip. You
	 * can change the enabled property at any time; the modified movie clip is immediately
	 * enabled or disabled. If enabled is set to false, the object is not
	 * included in automatic tab ordering.
	 */
	public get enabled(): boolean {
		//todo
		//console.log("enabled not implemented yet in flash/MovieClip");
		return false;
	}
	public set enabled(value: boolean) {
		//todo
		//console.log("enabled not implemented yet in flash/MovieClip");
	}

	/**
	 * The number of frames that are loaded from a streaming SWF file. You can use the framesLoaded
	 * property to determine whether the contents of a specific frame and all the frames before it
	 * loaded and are available locally in the browser. You can also use it to monitor the downloading
	 * of large SWF files. For example, you might want to display a message to users indicating that
	 * the SWF file is loading until a specified frame in the SWF file finishes loading.
	 *
	 *   If the movie clip contains multiple scenes, the framesLoaded property returns the number
	 * of frames loaded for all scenes in the movie clip.
	 */
	public get framesLoaded(): number {
		//todo
		console.log("framesLoaded not implemented yet in flash/MovieClip");
		return 0;
	}

	public get isPlaying(): boolean {
		//todo
		console.log("isPlaying not implemented yet in flash/MovieClip");
		return false;
	}

	/**
	 * An array of Scene objects, each listing the name, the number of frames,
	 * and the frame labels for a scene in the MovieClip instance.
	 */
	public get scenes(): any[] {
		//todo
		console.log("scenes not implemented yet in flash/MovieClip");
		return [];
	}

	/**
	 * The total number of frames in the MovieClip instance.
	 *
	 *   If the movie clip contains multiple frames, the totalFrames property returns
	 * the total number of frames in all scenes in the movie clip.
	 */
	public get totalFrames(): number {
		return (<AwayMovieClip>this._adaptee).numFrames;
	}

	/**
	 * Indicates whether other display objects that are SimpleButton or MovieClip objects can receive
	 * mouse release events or other user input release events. The trackAsMenu property lets you create menus. You
	 * can set the trackAsMenu property on any SimpleButton or MovieClip object.
	 * The default value of the trackAsMenu property is false.
	 *
	 *   You can change the trackAsMenu property at any time; the modified movie
	 * clip immediately uses the new behavior.
	 */
	public get trackAsMenu(): boolean {
		//todo
		console.log("trackAsMenu not implemented yet in flash/MovieClip");
		return false;
	}
	public set trackAsMenu(value: boolean) {
		//todo
		
		console.log("trackAsMenu not implemented yet in flash/MovieClip");
	}

	public getScripts() {
		return this._tmpScripts;
	}
	public addFrameScript(...args) {
		// arguments are pairs of frameIndex and script/function
		// frameIndex is in range 0..totalFrames-1
		var numArgs = arguments.length;
		if (numArgs & 1) {
			this.sec.throwError('ArgumentError TooFewArgumentsError', numArgs,
				numArgs + 1);
		}
		for (var i = 0; i < numArgs; i += 2) {
			var frameNum = (arguments[i] | 0);
			var fn = arguments[i + 1];
			(<AwayMovieClip>this.adaptee).timeline.add_avm2framescript(fn, frameNum);
			/*
			if(!this._tmpScripts[frameNum])
				this._tmpScripts[frameNum]=[];
			this._tmpScripts[frameNum].push(fn);*/
			
		}
	}

	/**
	 * Starts playing the SWF file at the specified frame.  This happens after all
	 * remaining actions in the frame have finished executing.  To specify a scene
	 * as well as a frame, specify a value for the scene parameter.
	 * @param	frame	A number representing the frame number, or a string representing the label of the
	 *   frame, to which the playhead is sent. If you specify a number, it is relative to the
	 *   scene you specify. If you do not specify a scene, the current scene determines the global frame number to play. If you do specify a scene, the playhead
	 *   jumps to the frame number in the specified scene.
	 * @param	scene	The name of the scene to play. This parameter is optional.
	 */
	public gotoAndPlay(frame: any, scene: string = null) {

		if (frame == null)
			return;


		if (typeof frame === "string") {
			// todo: only do toLowerCase if FP version <=9
			frame=frame.toLowerCase();
			if ((<AwayMovieClip>this.adaptee).timeline._labels[frame] == null) {
				frame = parseInt(frame);
				if (!isNaN(frame)) {
					(<AwayMovieClip>this.adaptee).currentFrameIndex = (<number>frame) - 1;
					(<AwayMovieClip>this.adaptee).play();
				}
				return;
			}
		}
		if (typeof frame === "number" && frame <= 0)
			return;
		this.play();
		this._gotoFrame(frame);
		FrameScriptManager.execute_queue();
	}

	/**
	 * Brings the playhead to the specified frame of the movie clip and stops it there.  This happens after all
	 * remaining actions in the frame have finished executing.  If you want to specify a scene in addition to a frame,
	 * specify a scene parameter.
	 * @param	frame	A number representing the frame number, or a string representing the label of the
	 *   frame, to which the playhead is sent. If you specify a number, it is relative to the
	 *   scene you specify. If you do not specify a scene, the current scene determines the global frame number at which to go to and stop. If you do specify a scene,
	 *   the playhead goes to the frame number in the specified scene and stops.
	 * @param	scene	The name of the scene. This parameter is optional.
	 * @throws	ArgumentError If the scene or frame specified are
	 *   not found in this movie clip.
	 */
	public gotoAndStop(frame: any, scene: string = null) {

		if (frame == null)
			return;

		if (typeof frame === "string") {
			// todo: only do toLowerCase if FP version <=9
			frame=frame.toLowerCase();
			if ((<AwayMovieClip>this.adaptee).timeline._labels[frame] == null) {
				frame = parseInt(frame);
				if (!isNaN(frame)) {
					(<AwayMovieClip>this.adaptee).currentFrameIndex = (<number>frame) - 1;
					(<AwayMovieClip>this.adaptee).stop();
				}
				return;
			}
		}
		if (typeof frame === "number" && frame <= 0)
			return;
		this.stop();
		this._gotoFrame(frame);
		FrameScriptManager.execute_queue();
	}


	private _gotoFrame(frame: any): void {
		if (typeof frame === "string") {
			(<AwayMovieClip>this._adaptee).jumpToLabel(<string>frame);
			return;

		}
		if (typeof frame === "number" && frame <= 0)
			return;
		(<AwayMovieClip>this._adaptee).currentFrameIndex = (<number>frame) - 1;
	}
	/**
	 * Sends the playhead to the next frame and stops it.  This happens after all
	 * remaining actions in the frame have finished executing.
	 */
	public nextFrame() {
		//todo
		console.log("nextFrame not implemented yet in flash/MovieClip");
	}

	/**
	 * Moves the playhead to the next scene of the MovieClip instance.  This happens after all
	 * remaining actions in the frame have finished executing.
	 */
	public nextScene() {
		//todo
		console.log("nextScene not implemented yet in flash/MovieClip");
	}

	/**
	 * Moves the playhead in the timeline of the movie clip.
	 */
	public play() {
		return (<AwayMovieClip>this._adaptee).play();
	}

	/**
	 * Sends the playhead to the previous frame and stops it.  This happens after all
	 * remaining actions in the frame have finished executing.
	 */
	public prevFrame() {
		if ((<AwayMovieClip>this._adaptee).currentFrameIndex > 0) {
			(<AwayMovieClip>this._adaptee).currentFrameIndex = (<AwayMovieClip>this._adaptee).currentFrameIndex - 1;
		}
	}

	/**
	 * Moves the playhead to the previous scene of the MovieClip instance.  This happens after all
	 * remaining actions in the frame have finished executing.
	 */
	public prevScene() {
		//todo
		console.log("prevScene not implemented yet in flash/MovieClip");
	}

	/**
	 * Stops the playhead in the movie clip.
	 */
	public stop() {
		return (<AwayMovieClip>this._adaptee).stop();
	}

}
